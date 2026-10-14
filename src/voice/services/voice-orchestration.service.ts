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
  type CandidateKind,
  type VoiceApiResponse,
  publicCandidate,
} from '../session/call-session.types.js';
import { AddressResolutionService } from './address-resolution.service.js';

interface AddressData {
  readonly postcode?: string;
  readonly city?: string;
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
    return this.sessions.runExclusive(input.callId, async () => {
      const callId = normalize(input.callId);
      const postcode = input.postcode.trim();
      const session = this.sessions.updateAddress(callId, input.side, { postcode });
      try {
        const candidates = await this.resolution.searchPostcode(postcode);
        return this.candidateResponse(session, input.side, candidates, 'city or municipality');
      } catch (error) {
        return this.integrationUnavailable(error, session, input.side);
      }
    });
  }

  public searchCity(input: CitySearchDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.callId, async () => {
      const callId = normalize(input.callId);
      const session = this.sessions.updateAddress(callId, input.side, { city: normalize(input.city) });
      const address = session[input.side];
      try {
        const candidates = await this.resolution.searchCity(address.city!, address.postcode);
        return this.candidateResponse(session, input.side, candidates, 'city or municipality');
      } catch (error) {
        return this.integrationUnavailable(error, session, input.side);
      }
    });
  }

  public confirmCity(input: CityConfirmDto): Promise<VoiceApiResponse<AddressData>> {
    return this.confirm(input.callId, input.side, normalize(input.candidateId), 'CITY');
  }

  public searchAddress(input: AddressSearchDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.callId, async () => {
      const callId = normalize(input.callId);
      const patch = {
        ...(input.street === undefined ? {} : { street: normalize(input.street) }),
        ...(input.houseNumber === undefined ? {} : { houseNumber: normalize(input.houseNumber) }),
      };
      const session = this.sessions.updateAddress(callId, input.side, patch);
      const address = session[input.side];
      const missing = [!address.city && 'city', !address.street && 'street', !address.houseNumber && 'house number']
        .filter(Boolean) as string[];
      if (missing.length > 0) {
        return {
          status: 'NEEDS_CLARIFICATION',
          callId,
          side: input.side,
          data: addressData(address),
          clarificationQuestion: `Please provide the ${missing.join(' and ')}.`,
        };
      }
      try {
        const candidates = await this.resolution.searchAddress(address);
        return this.candidateResponse(session, input.side, candidates, 'address');
      } catch (error) {
        return this.integrationUnavailable(error, session, input.side);
      }
    });
  }

  public confirmAddress(input: CityConfirmDto): Promise<VoiceApiResponse<AddressData>> {
    return this.confirm(input.callId, input.side, normalize(input.candidateId), 'ADDRESS');
  }

  public searchRides(input: VoiceRideSearchDto): Promise<VoiceApiResponse> {
    return this.sessions.runExclusive(input.callId, async () => {
      const callId = normalize(input.callId);
      const session = this.sessions.get(callId);
      if (!session) {
        return {
          status: 'INVALID_CONTEXT',
          callId,
          clarificationQuestion: 'The call session is missing or expired. Collect both addresses again.',
        };
      }
      const unresolved = ([['origin', session.origin], ['destination', session.destination]] as const)
        .filter(([, address]) => address.status !== 'CONFIRMED' || !address.resolvedLocation)
        .map(([side]) => side);
      if (unresolved.length > 0) {
        return {
          status: 'NEEDS_CLARIFICATION',
          callId,
          data: { unresolved },
          clarificationQuestion: `Resolve the ${unresolved.join(' and ')} address before searching for rides.`,
        };
      }

      const response = await this.trips.searchResolved({
        departure: this.location(session.origin),
        destination: this.location(session.destination),
        time: input.requestedTime,
        ...(input.seatsRequested === undefined ? {} : { seatsRequested: input.seatsRequested }),
      });
      this.sessions.save({ ...session, requestedTime: normalize(input.requestedTime) });
      return { status: 'RESOLVED', callId, data: response };
    });
  }

  public endCall(callId: string): Promise<VoiceApiResponse<{ deleted: boolean }>> {
    const normalized = normalize(callId);
    return this.sessions.runExclusive(normalized, () => ({
      status: 'RESOLVED',
      callId: normalized,
      data: { deleted: this.sessions.delete(normalized) },
    }));
  }

  private confirm(
    callIdValue: string,
    side: AddressSide,
    candidateId: string,
    kind: CandidateKind,
  ): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(callIdValue, () => {
      const callId = normalize(callIdValue);
      const session = this.sessions.get(callId);
      const candidate = session?.[side].candidates.find((item) => item.id === candidateId);
      if (!session || !candidate || candidate.kind !== kind) {
        return {
          status: 'INVALID_CONTEXT',
          callId,
          side,
          clarificationQuestion: 'That candidate is invalid or stale. Search again before selecting an option.',
        };
      }
      try {
        const confirmed = this.sessions.confirmCandidate(callId, side, candidateId);
        return {
          status: kind === 'ADDRESS' ? 'RESOLVED' : 'COLLECTING',
          callId,
          side,
          data: addressData(confirmed[side]),
        };
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) {
          return {
            status: 'INVALID_CONTEXT',
            callId,
            side,
            clarificationQuestion: error.message,
          };
        }
        throw error;
      }
    });
  }

  private candidateResponse(
    session: CallSession,
    side: AddressSide,
    candidates: AddressCandidate[],
    subject: string,
  ): VoiceApiResponse<AddressData> {
    const address = session[side];
    if (candidates.length === 0) {
      const saved = this.sessions.save({
        ...session,
        [side]: { ...address, status: 'COLLECTING', candidates: [] },
      });
      return {
        status: 'NOT_FOUND',
        callId: session.callId,
        side,
        data: addressData(saved[side]),
        clarificationQuestion: `No matching ${subject} was found. Please clarify it.`,
      };
    }
    const resolutionStatus = candidates.length === 1 ? 'NEEDS_CONFIRMATION' : 'AMBIGUOUS';
    const saved = this.sessions.save({
      ...session,
      [side]: { ...address, status: resolutionStatus, candidates },
    });
    return {
      status: 'NEEDS_CONFIRMATION',
      callId: session.callId,
      side,
      data: addressData(saved[side]),
      candidates: candidates.map(publicCandidate),
      clarificationQuestion: `Please confirm the intended ${subject}.`,
    };
  }

  private integrationUnavailable<T>(
    error: unknown,
    session: CallSession,
    side: AddressSide,
  ): VoiceApiResponse<T> {
    if (!(error instanceof HttpError) || ![502, 503].includes(error.status)) throw error;
    return {
      status: 'INTEGRATION_UNAVAILABLE',
      callId: session.callId,
      side,
      clarificationQuestion: 'Address matching is not configured. Please try again later.',
    };
  }

  private location(address: AddressState): LocationCandidate {
    const location = address.resolvedLocation;
    if (!location) throw new HttpError(409, 'The address is not resolved.');
    return {
      publicName: location.displayName,
      addressLine: location.displayName,
      longitude: location.longitude,
      latitude: location.latitude,
      ...(location.externalId ? { externalId: location.externalId } : {}),
    };
  }
}
