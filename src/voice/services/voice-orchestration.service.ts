import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../../common/errors/http.error.js';
import { TripSearchService } from '../../inbound/trip-search.service.js';
import type { LocationCandidate } from '../../mapbox/mapbox.types.js';
import type { AddressSearchDto } from '../dto/address-search.dto.js';
import type { VoiceBookingDto } from '../dto/booking.dto.js';
import type { CityConfirmDto } from '../dto/city-confirm.dto.js';
import type { CitySearchDto } from '../dto/city-search.dto.js';
import type { PostcodeSearchDto } from '../dto/postcode-search.dto.js';
import type { VoiceRideSearchDto } from '../dto/ride-search.dto.js';
import type { FonioAddressContextDto, SidedVoiceRequestDto } from '../dto/voice-request.dto.js';
import { CALL_SESSION_STORE, type CallSessionStore } from '../session/call-session-store.interface.js';
import {
  type AddressCandidate,
  type AddressSide,
  type AddressState,
  type CallSession,
  type CandidateKind,
  type VoiceApiResponse,
  AddressSide as Side,
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

function required(value: string | undefined, field: string): string {
  const normalized = value === undefined ? '' : normalize(value);
  if (!normalized) throw new HttpError(400, `${field} must be a non-empty string.`);
  return normalized;
}

function confirmationValue(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new HttpError(400, 'confirmed must be true or false.');
}

function sidedRequest(input: SidedVoiceRequestDto): { side: AddressSide; context?: FonioAddressContextDto } {
  const nestedSides = [
    ...(input.from === undefined ? [] : [Side.ORIGIN]),
    ...(input.destination === undefined ? [] : [Side.DESTINATION]),
  ];
  if (nestedSides.length > 1) throw new HttpError(400, 'Supply either from or destination, not both.');
  const nestedSide = nestedSides[0];
  if (input.side && nestedSide && input.side !== nestedSide) {
    throw new HttpError(400, 'side conflicts with the supplied from or destination object.');
  }
  const side = input.side ?? nestedSide;
  if (!side) throw new HttpError(400, 'Supply side, from, or destination.');
  return {
    side,
    ...(side === Side.ORIGIN && input.from ? { context: input.from } : {}),
    ...(side === Side.DESTINATION && input.destination ? { context: input.destination } : {}),
  };
}

function contextValue(flat: string | undefined, nested: string | undefined): string | undefined {
  return flat ?? nested;
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

function withoutSelectedRide(session: CallSession): CallSession {
  const copy = { ...session };
  delete copy.selectedRide;
  return copy;
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
      const { side, context } = sidedRequest(input);
      const postcode = normalize(contextValue(input.postcode, context?.postcode) ?? '');
      if (!postcode) {
        const session = this.sessions.getOrCreate(sessionId);
        return { status: 'COLLECTING', sessionId, side, data: addressData(session[side]) };
      }
      if (!/^\d{4}$/.test(postcode)) throw new HttpError(400, 'postcode must be an Austrian four-digit string.');
      const session = this.sessions.save(withoutSelectedRide(
        this.sessions.updateAddress(sessionId, side, { postcode }),
      ));
      try {
        const candidates = await this.resolution.searchPostcode(postcode);
        const candidate = candidates.length === 1 ? candidates[0] : undefined;
        if (candidate) return this.selectCityCandidate(session, side, candidate, 'RESOLVED');
        return this.candidateResponse(session, side, candidates, 'Stadt oder Gemeinde');
      } catch (error) {
        return this.integrationUnavailable(error, session, side);
      }
    });
  }

  public searchCity(input: CitySearchDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const sessionId = normalize(input.sessionId);
      const { side, context } = sidedRequest(input);
      const spokenCity = required(contextValue(input.city, context?.city), 'city');
      let existing = this.sessions.getOrCreate(sessionId);
      const suppliedPostcode = normalize(context?.postcode ?? '');
      if (!existing[side].postcode && suppliedPostcode) {
        existing = this.sessions.updateAddress(sessionId, side, { postcode: suppliedPostcode });
      }
      const previousAddress = existing[side];
      const session = this.sessions.save({
        ...withoutSelectedRide(existing),
        [side]: {
          ...(previousAddress.postcode ? { postcode: previousAddress.postcode } : {}),
          status: 'COLLECTING',
          candidates: [],
        },
      });
      const address = session[side];
      try {
        const candidates = await this.resolution.searchCity(spokenCity, address.postcode);
        const candidate = candidates.length === 1 && (candidates[0]?.score ?? 0) >= 0.95 ? candidates[0] : undefined;
        if (candidate) return this.selectCityCandidate(session, side, candidate, 'RESOLVED');
        return this.candidateResponse(session, side, candidates, 'Stadt oder Gemeinde');
      } catch (error) {
        if (error instanceof HttpError && error.status === 422) {
          return {
            status: 'NEEDS_CLARIFICATION', sessionId, side, data: addressData(address),
            clarificationQuestion: 'Bitte präzisieren Sie die Stadt oder Gemeinde.',
          };
        }
        return this.integrationUnavailable(error, session, side);
      }
    });
  }

  public confirmCity(input: CityConfirmDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.sessionId, () => {
      const sessionId = normalize(input.sessionId);
      const confirmedByCaller = confirmationValue(input.confirmed);
      const { side } = sidedRequest(input);
      const session = this.sessions.get(sessionId);
      const candidate = session && this.selectedCandidate(session, side, input.candidateToken ?? input.candidateId, 'CITY');
      if (!session || !candidate) return this.invalidCandidate(sessionId, side);
      if (confirmedByCaller === false) {
        return { status: 'DECLINED', sessionId, side, data: addressData(session[side]) };
      }
      try {
        const confirmed = this.sessions.confirmCandidate(sessionId, side, candidate.id);
        return { status: 'COLLECTING', sessionId, side, data: addressData(confirmed[side]) };
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) return this.invalidCandidate(sessionId, side);
        throw error;
      }
    });
  }

  public searchAddress(input: AddressSearchDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const sessionId = normalize(input.sessionId);
      const { side, context } = sidedRequest(input);
      let existing = this.sessions.getOrCreate(sessionId);
      const contextPostcode = normalize(contextValue(input.postcode, context?.postcode) ?? '');
      const contextCity = normalize(contextValue(input.city, context?.city) ?? '');
      if (!existing[side].postcode && contextPostcode) {
        existing = this.sessions.updateAddress(sessionId, side, { postcode: contextPostcode });
      }
      if (!existing[side].city && contextCity) {
        existing = this.sessions.updateAddress(sessionId, side, { city: contextCity });
      }
      const patch = {
        street: required(contextValue(input.street, context?.street), 'street'),
        houseNumber: required(contextValue(input.houseNumber, context?.houseNumber), 'houseNumber'),
      };
      const session = this.sessions.save(withoutSelectedRide(
        this.sessions.updateAddress(sessionId, side, patch),
      ));
      const address = session[side];
      const missing = [
        !address.city && 'die Stadt oder Gemeinde',
        !address.street && 'die Straße',
        !address.houseNumber && 'die Hausnummer',
      ].filter(Boolean) as string[];
      if (missing.length > 0) {
        return {
          status: 'NEEDS_CLARIFICATION', sessionId, side, data: addressData(address),
          clarificationQuestion: `Bitte ergänzen Sie ${missing.join(' und ')}.`,
        };
      }
      try {
        const candidates = await this.resolution.searchAddress(address);
        const candidate = candidates.length === 1 ? candidates[0] : undefined;
        if (candidate && context) return this.resolveAddressCandidate(session, side, candidate);
        return this.candidateResponse(session, side, candidates, 'Straße');
      } catch (error) {
        return this.integrationUnavailable(error, session, side);
      }
    });
  }

  public confirmAddress(input: CityConfirmDto): Promise<VoiceApiResponse<AddressData>> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const sessionId = normalize(input.sessionId);
      const confirmedByCaller = confirmationValue(input.confirmed);
      const { side } = sidedRequest(input);
      const session = this.sessions.get(sessionId);
      const reference = normalize(input.candidateToken ?? input.candidateId ?? '');
      if (
        session?.[side].status === 'CONFIRMED'
        && reference
        && session[side].confirmedCandidateToken === reference
      ) {
        return {
          status: confirmedByCaller === false ? 'DECLINED' : 'RESOLVED',
          sessionId,
          side,
          data: addressData(session[side]),
        };
      }
      const candidate = session && this.selectedCandidate(session, side, reference, 'ADDRESS');
      if (!session || !candidate) return this.invalidCandidate(sessionId, side);
      if (confirmedByCaller === false) {
        return { status: 'DECLINED', sessionId, side, data: addressData(session[side]) };
      }
      try {
        return await this.resolveAddressCandidate(session, side, candidate);
      } catch (error) {
        return this.integrationUnavailable(error, session, side);
      }
    });
  }

  public searchRides(input: VoiceRideSearchDto): Promise<VoiceApiResponse> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const sessionId = normalize(input.sessionId);
      const requestedTime = required(input.requestedTime ?? input.time, 'time');
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
        time: requestedTime,
        ...(input.seatsRequested === undefined ? {} : { seatsRequested: input.seatsRequested }),
      });
      const rideId = response.rideDetails?.rideId;
      const numericSeats = typeof input.seatsRequested === 'number' ? input.seatsRequested : undefined;
      this.sessions.save({
        ...withoutSelectedRide(session),
        requestedTime,
        ...(numericSeats === undefined ? {} : { seatsRequested: numericSeats }),
        ...(rideId ? { selectedRide: { rideId, proposalToken: rideId } } : {}),
      });
      if (!rideId) return { status: 'RESOLVED', sessionId, data: response };
      const compatible = { ...response, proposalToken: rideId };
      return { status: 'RESOLVED', sessionId, proposalToken: rideId, data: compatible };
    });
  }

  public book(input: VoiceBookingDto): Promise<VoiceApiResponse> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const sessionId = normalize(input.sessionId);
      const confirmedByCaller = confirmationValue(input.confirmed);
      if (confirmedByCaller === undefined) throw new HttpError(400, 'confirmed must be true or false.');
      const session = this.sessions.get(sessionId);
      const proposalToken = normalize(input.proposalToken ?? '');
      const requestedRideId = normalize(input.rideId ?? '');
      const selectedRide = session?.selectedRide;

      if (selectedRide) {
        const reference = proposalToken || requestedRideId;
        if (!reference || (reference !== selectedRide.proposalToken && reference !== selectedRide.rideId)) {
          return {
            status: 'INVALID_CONTEXT', sessionId,
            clarificationQuestion: 'That proposal is invalid or stale. Search for a ride again before booking.',
          };
        }
        const compatibleProposalToken = selectedRide.proposalToken || selectedRide.rideId;
        if (!confirmedByCaller) {
          return {
            status: 'DECLINED', sessionId, proposalToken: compatibleProposalToken,
            data: { rideId: selectedRide.rideId, booked: false },
          };
        }
        const booking = await this.trips.join(selectedRide.rideId);
        return {
          status: 'PENDING_BOOKING', sessionId, proposalToken: compatibleProposalToken,
          data: { rideId: selectedRide.rideId, booked: true, booking },
        };
      }

      // Backwards compatibility for the original /api/trips/search -> /ride/join flow.
      // TripSearchService still verifies that the ride came from a recent search.
      if (!proposalToken && requestedRideId) {
        if (!confirmedByCaller) {
          return {
            status: 'DECLINED', sessionId, proposalToken: requestedRideId,
            data: { rideId: requestedRideId, booked: false },
          };
        }
        const booking = await this.trips.join(requestedRideId);
        return {
          status: 'PENDING_BOOKING', sessionId, proposalToken: requestedRideId,
          data: { rideId: requestedRideId, booked: true, booking },
        };
      }

      return {
        status: 'INVALID_CONTEXT', sessionId,
        clarificationQuestion: 'That proposal is invalid or stale. Search for a ride again before booking.',
      };
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
    const visibleCandidates = candidates.slice(0, 3);
    if (visibleCandidates.length === 0) {
      const saved = this.sessions.save({ ...session, [side]: { ...address, status: 'COLLECTING', candidates: [] } });
      return {
        status: 'NOT_FOUND', sessionId: session.sessionId, side, data: addressData(saved[side]),
        clarificationQuestion: `Keine passende ${subject} wurde gefunden. Bitte präzisieren Sie die Angabe.`,
      };
    }
    const saved = this.sessions.save({
      ...session,
      [side]: {
        ...address,
        status: visibleCandidates.length === 1 ? 'NEEDS_CONFIRMATION' : 'AMBIGUOUS',
        candidates: visibleCandidates,
      },
    });
    return {
      status: visibleCandidates.length === 1 ? 'NEEDS_CONFIRMATION' : 'NEEDS_CLARIFICATION',
      sessionId: session.sessionId,
      side,
      data: addressData(saved[side]),
      candidates: visibleCandidates.map((candidate, index) => publicCandidate(candidate, index)),
      clarificationQuestion: visibleCandidates.length === 1
        ? `Bitte bestätigen Sie die gefundene ${subject}.`
        : `Welche ${subject} meinen Sie?`,
    };
  }

  private async resolveAddressCandidate(
    session: CallSession,
    side: AddressSide,
    candidate: AddressCandidate,
  ): Promise<VoiceApiResponse<AddressData>> {
    if (candidate.latitude !== undefined && candidate.longitude !== undefined) {
      this.sessions.save({
        ...session,
        [side]: {
          ...session[side],
          status: 'NEEDS_CONFIRMATION',
          candidates: [candidate],
          confirmedCandidateToken: candidate.id,
        },
      });
      const confirmed = this.sessions.confirmCandidate(session.sessionId, side, candidate.id);
      return { status: 'RESOLVED', sessionId: session.sessionId, side, data: addressData(confirmed[side]) };
    }
    const geocoded = await this.resolution.geocodeAddress(session[side], candidate);
    if (geocoded.length === 0) {
      const saved = this.sessions.save({
        ...session,
        [side]: { ...session[side], status: 'COLLECTING', candidates: [] },
      });
      return {
        status: 'NOT_FOUND', sessionId: session.sessionId, side, data: addressData(saved[side]),
        clarificationQuestion: 'Die Hausnummer konnte für diese Adresse nicht eindeutig geocodiert werden. Bitte prüfen Sie die Angaben.',
      };
    }
    if (geocoded.length > 1) return this.candidateResponse(session, side, geocoded, 'Adresse');
    const verified = geocoded[0];
    if (!verified) return this.invalidCandidate(session.sessionId, side);
    this.sessions.save({
      ...session,
      [side]: {
        ...session[side],
        status: 'NEEDS_CONFIRMATION',
        candidates: [verified],
        confirmedCandidateToken: candidate.id,
      },
    });
    const confirmed = this.sessions.confirmCandidate(session.sessionId, side, verified.id);
    return { status: 'RESOLVED', sessionId: session.sessionId, side, data: addressData(confirmed[side]) };
  }

  private selectedCandidate(
    session: CallSession,
    side: AddressSide,
    reference: string | undefined,
    kind: CandidateKind,
  ): AddressCandidate | undefined {
    const candidates = session[side].candidates;
    const normalized = normalize(reference ?? '');
    if (!normalized || !['AMBIGUOUS', 'NEEDS_CONFIRMATION'].includes(session[side].status)) return undefined;
    const direct = candidates.find((candidate) => candidate.id === normalized);
    if (direct) return direct.kind === kind ? direct : undefined;
    const option = normalized.match(/^option\s+([abc])$/i);
    if (!option) return undefined;
    const index = option[1]?.toLowerCase().charCodeAt(0) ?? 0;
    const candidate = candidates[index - 97];
    return candidate?.kind === kind ? candidate : undefined;
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
