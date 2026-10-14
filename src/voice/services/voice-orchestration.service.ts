import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../../common/errors/http.error.js';
import { TripSearchService } from '../../inbound/trip-search.service.js';
import type { LocationCandidate } from '../../mapbox/mapbox.types.js';
import type { AddressSearchDto } from '../dto/address-search.dto.js';
import type { CityConfirmDto } from '../dto/city-confirm.dto.js';
import type { CitySearchDto } from '../dto/city-search.dto.js';
import type { PostcodeSearchDto } from '../dto/postcode-search.dto.js';
import type { VoiceRideSearchDto } from '../dto/ride-search.dto.js';
import { CALL_SESSION_STORE, type CallSessionStore } from '../session/call-session-store.interface.js';
import {
  type AddressCandidate,
  type AddressSide,
  type AddressState,
  type CallSession,
  type VoiceApiResponse,
  publicCandidate,
} from '../session/call-session.types.js';
import { AddressResolutionService } from './address-resolution.service.js';

interface AddressData {
  readonly postcode?: string;
  readonly city?: string;
  readonly locality?: string;
  readonly street?: string;
  readonly houseNumber?: string;
  readonly resolutionStatus: AddressState['status'];
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function addressData(address: AddressState): AddressData {
  return {
    ...(address.postcode ? { postcode: address.postcode } : {}),
    ...(address.city ? { city: address.city } : {}),
    ...(address.locality ? { locality: address.locality } : {}),
    ...(address.street ? { street: address.street } : {}),
    ...(address.houseNumber ? { houseNumber: address.houseNumber } : {}),
    resolutionStatus: address.status,
  };
}

@Injectable()
export class VoiceOrchestrationService {
  public constructor(
    @Inject(CALL_SESSION_STORE) private readonly sessions: CallSessionStore,
    @Inject(AddressResolutionService) private readonly resolution: AddressResolutionService,
    @Inject(TripSearchService) private readonly trips: TripSearchService,
  ) {}

  public searchPostcode(input: PostcodeSearchDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const sessionId = normalize(input.sessionId);
      const postcode = input.postcode.trim();
      const session = this.sessions.updateAddress(sessionId, input.side, { postcode });
      try {
        const candidates = await this.resolution.searchPostcode(postcode);
        const candidate = candidates.length === 1 ? candidates[0] : undefined;
        if (candidate) return this.selectCityCandidate(session, input.side, candidate, 'RESOLVED');
        return this.candidateResponse(session, input.side, candidates, 'Stadt oder Gemeinde');
      } catch (error) {
        return this.integrationUnavailable(error, session, input.side);
      }
    });
  }

  public searchCity(input: CitySearchDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const sessionId = normalize(input.sessionId);
      const spokenCity = normalize(input.city);
      const existing = this.sessions.getOrCreate(sessionId);
      const previousAddress = existing[input.side];
      const session = this.sessions.save({
        ...existing,
        [input.side]: {
          ...(previousAddress.postcode ? { postcode: previousAddress.postcode } : {}),
          status: 'COLLECTING',
          candidates: [],
        },
      });
      const address = session[input.side];
      try {
        const candidates = await this.resolution.searchCity(spokenCity, address.postcode);
        const candidate = candidates.length === 1 && (candidates[0]?.score ?? 0) >= 0.95 ? candidates[0] : undefined;
        if (candidate) return this.selectCityCandidate(session, input.side, candidate, 'RESOLVED');
        return this.candidateResponse(session, input.side, candidates, 'Stadt oder Gemeinde');
      } catch (error) {
        if (error instanceof HttpError && error.status === 422) {
          return {
            status: 'NEEDS_CLARIFICATION', sessionId, side: input.side, data: addressData(address),
            clarificationQuestion: 'Bitte nennen Sie auch die vierstellige Postleitzahl.',
          };
        }
        return this.integrationUnavailable(error, session, input.side);
      }
    });
  }

  public confirmCity(input: CityConfirmDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.sessionId, () => {
      const sessionId = normalize(input.sessionId);
      const session = this.sessions.get(sessionId);
      const candidateId = normalize(input.candidateId);
      const candidate = session?.[input.side].candidates.find((item) => item.id === candidateId);
      if (!session || !candidate || candidate.kind !== 'CITY') return this.invalidCandidate(sessionId, input.side);
      try {
        const confirmed = this.sessions.confirmCandidate(sessionId, input.side, candidateId);
        return { status: 'COLLECTING', sessionId, side: input.side, data: addressData(confirmed[input.side]) };
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) return this.invalidCandidate(sessionId, input.side);
        throw error;
      }
    });
  }

  public searchAddress(input: AddressSearchDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const sessionId = normalize(input.sessionId);
      const patch = {
        ...(input.street === undefined ? {} : { street: normalize(input.street) }),
        ...(input.houseNumber === undefined ? {} : { houseNumber: normalize(input.houseNumber) }),
      };
      const session = this.sessions.updateAddress(sessionId, input.side, patch);
      const address = session[input.side];
      const missing = [
        !address.postcode && 'die Postleitzahl',
        !address.city && 'die Stadt oder Gemeinde',
        !address.street && 'die Straße',
        !address.houseNumber && 'die Hausnummer',
      ].filter(Boolean) as string[];
      if (missing.length > 0) {
        return {
          status: 'NEEDS_CLARIFICATION', sessionId, side: input.side, data: addressData(address),
          clarificationQuestion: `Bitte ergänzen Sie ${missing.join(' und ')}.`,
        };
      }
      try {
        const candidates = await this.resolution.searchAddress(address);
        return this.candidateResponse(session, input.side, candidates, 'Straße');
      } catch (error) {
        return this.integrationUnavailable(error, session, input.side);
      }
    });
  }

  public confirmAddress(input: CityConfirmDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const sessionId = normalize(input.sessionId);
      const session = this.sessions.get(sessionId);
      const candidateId = normalize(input.candidateId);
      const candidate = session?.[input.side].candidates.find((item) => item.id === candidateId);
      if (!session || !candidate || candidate.kind !== 'ADDRESS') return this.invalidCandidate(sessionId, input.side);
      try {
        if (candidate.latitude !== undefined && candidate.longitude !== undefined) {
          const confirmed = this.sessions.confirmCandidate(sessionId, input.side, candidate.id);
          return { status: 'RESOLVED', sessionId, side: input.side, data: addressData(confirmed[input.side]) };
        }
        const geocoded = await this.resolution.geocodeAddress(session[input.side], candidate);
        if (geocoded.length === 0) {
          const saved = this.sessions.save({
            ...session,
            [input.side]: { ...session[input.side], status: 'COLLECTING', candidates: [] },
          });
          return {
            status: 'NOT_FOUND', sessionId, side: input.side, data: addressData(saved[input.side]),
            clarificationQuestion: 'Die Hausnummer konnte für diese Adresse nicht eindeutig geocodiert werden. Bitte prüfen Sie die Angaben.',
          };
        }
        if (geocoded.length > 1) return this.candidateResponse(session, input.side, geocoded, 'Adresse');
        const verified = geocoded[0];
        if (!verified) return this.invalidCandidate(sessionId, input.side);
        this.sessions.save({
          ...session,
          [input.side]: { ...session[input.side], status: 'NEEDS_CONFIRMATION', candidates: [verified] },
        });
        const confirmed = this.sessions.confirmCandidate(sessionId, input.side, verified.id);
        return { status: 'RESOLVED', sessionId, side: input.side, data: addressData(confirmed[input.side]) };
      } catch (error) {
        return this.integrationUnavailable(error, session, input.side);
      }
    });
  }

  public searchRides(input: VoiceRideSearchDto): Promise<VoiceApiResponse> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const sessionId = normalize(input.sessionId);
      const session = this.sessions.get(sessionId);
      if (!session) {
        return {
          status: 'INVALID_CONTEXT', sessionId,
          clarificationQuestion: 'The call session is missing or expired. Collect both addresses again.',
        };
      }
      const unresolved = ([['origin', session.origin], ['destination', session.destination]] as const)
        .filter(([, address]) => address.status !== 'CONFIRMED' || !address.resolvedLocation)
        .map(([side]) => side);
      if (unresolved.length > 0) {
        return {
          status: 'NEEDS_CLARIFICATION', sessionId, data: { unresolved },
          clarificationQuestion: `Resolve the ${unresolved.join(' and ')} address before searching for rides.`,
        };
      }
      const response = await this.trips.searchResolved({
        departure: this.location(session.origin), destination: this.location(session.destination),
        time: input.requestedTime,
        ...(input.seatsRequested === undefined ? {} : { seatsRequested: input.seatsRequested }),
      });
      this.sessions.save({ ...session, requestedTime: normalize(input.requestedTime) });
      return { status: 'RESOLVED', sessionId, data: response };
    });
  }

  public endCall(sessionId: string): Promise<VoiceApiResponse<{ deleted: boolean }>> {
    const normalized = normalize(sessionId);
    return this.sessions.runExclusive(normalized, () => ({
      status: 'RESOLVED', sessionId: normalized, data: { deleted: this.sessions.delete(normalized) },
    }));
  }

  private candidateResponse(
    session: CallSession,
    side: AddressSide,
    candidates: AddressCandidate[],
    subject: string,
  ): VoiceApiResponse<AddressData> {
    const address = session[side];
    if (candidates.length === 0) {
      const saved = this.sessions.save({ ...session, [side]: { ...address, status: 'COLLECTING', candidates: [] } });
      return {
        status: 'NOT_FOUND', sessionId: session.sessionId, side, data: addressData(saved[side]),
        clarificationQuestion: `Keine passende ${subject} wurde gefunden. Bitte präzisieren Sie die Angabe.`,
      };
    }
    const saved = this.sessions.save({
      ...session,
      [side]: { ...address, status: candidates.length === 1 ? 'NEEDS_CONFIRMATION' : 'AMBIGUOUS', candidates },
    });
    return {
      status: candidates.length === 1 ? 'NEEDS_CONFIRMATION' : 'NEEDS_CLARIFICATION',
      sessionId: session.sessionId,
      side,
      data: addressData(saved[side]),
      candidates: candidates.map(publicCandidate),
      clarificationQuestion: candidates.length === 1
        ? `Bitte bestätigen Sie die gefundene ${subject}.`
        : `Welche ${subject} meinen Sie?`,
    };
  }

  private selectCityCandidate(
    session: CallSession,
    side: AddressSide,
    candidate: AddressCandidate,
    status: 'RESOLVED' | 'COLLECTING',
  ): VoiceApiResponse<AddressData> {
    this.sessions.save({ ...session, [side]: { ...session[side], status: 'NEEDS_CONFIRMATION', candidates: [candidate] } });
    const confirmed = this.sessions.confirmCandidate(session.sessionId, side, candidate.id);
    return { status, sessionId: session.sessionId, side, data: addressData(confirmed[side]) };
  }

  private invalidCandidate(sessionId: string, side: AddressSide): VoiceApiResponse<AddressData> {
    return {
      status: 'INVALID_CONTEXT', sessionId, side,
      clarificationQuestion: 'That candidate is invalid or stale. Search again before selecting an option.',
    };
  }

  private integrationUnavailable<T>(error: unknown, session: CallSession, side: AddressSide): VoiceApiResponse<T> {
    if (!(error instanceof HttpError) || ![502, 503].includes(error.status)) throw error;
    return {
      status: 'INTEGRATION_UNAVAILABLE', sessionId: session.sessionId, side,
      clarificationQuestion: 'Die Adresssuche ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut.',
    };
  }

  private location(address: AddressState): LocationCandidate {
    const location = address.resolvedLocation;
    if (!location) throw new HttpError(409, 'The address is not resolved.');
    return {
      publicName: location.displayName, addressLine: location.displayName,
      longitude: location.longitude, latitude: location.latitude,
      ...(location.externalId ? { externalId: location.externalId } : {}),
    };
  }
}
