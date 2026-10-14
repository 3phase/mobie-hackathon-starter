import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../../common/errors/http.error.js';
import { MobieService } from '../../mobie/mobie.service.js';
import type { AddressConfirmDto } from '../dto/address-confirm.dto.js';
import type { AddressSearchDto } from '../dto/address-search.dto.js';
import type { BookingConfirmDto } from '../dto/booking-confirm.dto.js';
import type { CityConfirmDto } from '../dto/city-confirm.dto.js';
import type { CitySearchDto } from '../dto/city-search.dto.js';
import type { PostcodeSearchDto } from '../dto/postcode-search.dto.js';
import type { VoiceRideSearchDto } from '../dto/ride-search.dto.js';
import type {
  CanonicalAddress,
  VoiceAddressContext,
  VoiceAddressSide,
  VoiceCityContext,
  VoiceConversationResponse,
  VoiceTripContext,
} from '../guided-booking.types.js';
import { CALL_SESSION_STORE, type CallSessionStore } from '../session/call-session-store.interface.js';
import {
  AddressSide,
  type AddressCandidate,
  type AddressState,
  type CallSession,
  type StoredRideProposal,
} from '../session/call-session.types.js';
import { AddressResolutionService } from './address-resolution.service.js';

type SidedRequest<T> = { readonly sessionId: string; readonly from?: T; readonly destination?: T };
type UnknownRecord = Record<string, unknown>;

interface ProposalResult {
  readonly publicProposal: UnknownRecord;
  readonly storedProposal: StoredRideProposal;
}

const optionLetters = ['A', 'B', 'C'] as const;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function postcode(value: string | undefined): string {
  return value?.trim() ?? '';
}

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cityContext(input: { readonly postcode?: string; readonly city: string }): VoiceCityContext {
  return { postcode: postcode(input.postcode), city: normalize(input.city) };
}

function addressContext(input: {
  readonly postcode?: string;
  readonly city: string;
  readonly street: string;
  readonly houseNumber: string;
}): VoiceAddressContext {
  return {
    ...cityContext(input),
    street: normalize(input.street),
    houseNumber: normalize(input.houseNumber),
  };
}

function tripContext(input: VoiceRideSearchDto): VoiceTripContext {
  const location = (value: VoiceRideSearchDto['from']): CanonicalAddress => ({
    ...addressContext(value),
    publicName: normalize(value.publicName),
    addressLine: normalize(value.addressLine),
    longitude: value.longitude,
    latitude: value.latitude,
  });
  const time = input.time.trim();
  if (!Number.isFinite(Date.parse(time))) {
    throw new HttpError(400, 'time muss ein gültiger ISO-8601-Zeitpunkt mit Zeitzonenoffset sein.');
  }
  return {
    from: location(input.from),
    destination: location(input.destination),
    time,
    seatsRequested: input.seatsRequested,
  };
}

@Injectable()
export class VoiceOrchestrationService {
  public constructor(
    @Inject(CALL_SESSION_STORE) private readonly sessions: CallSessionStore,
    @Inject(AddressResolutionService) private readonly resolution: AddressResolutionService,
    @Inject(MobieService) private readonly mobie: MobieService,
  ) {}

  public searchPostcode(input: PostcodeSearchDto): Promise<VoiceConversationResponse> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const [externalSide, supplied] = this.side(input);
      const side = this.internalSide(externalSide);
      const normalizedPostcode = supplied.postcode.trim();
      const candidates = await this.resolution.searchPostcode(normalizedPostcode);
      const session = this.sessions.updateAddress(input.sessionId, side, { postcode: normalizedPostcode });
      if (candidates.length === 0) {
        return this.clarification(session.sessionId, 'Diese Postleitzahl konnte ich in Österreich nicht finden. Bitte prüfe sie noch einmal.');
      }
      return {
        sessionId: session.sessionId,
        status: 'accepted',
        message: externalSide === 'from'
          ? 'In welcher Stadt oder Gemeinde möchtest du losfahren?'
          : 'In welche Stadt oder Gemeinde möchtest du fahren?',
        accepted: { [externalSide]: { postcode: normalizedPostcode } },
        selectionMethod: 'direct_input',
      };
    });
  }

  public searchCity(input: CitySearchDto): Promise<VoiceConversationResponse> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const [externalSide, supplied] = this.side(input);
      const side = this.internalSide(externalSide);
      const context = cityContext(supplied);
      const session = this.sessions.updateAddress(input.sessionId, side, context);
      const candidates = await this.resolution.searchCity(context.city, context.postcode || undefined);
      return this.cityResult(session, externalSide, side, context, candidates);
    });
  }

  public confirmCity(input: CityConfirmDto): Promise<VoiceConversationResponse> {
    return this.sessions.runExclusive(input.sessionId, () => {
      const [externalSide, supplied] = this.side(input);
      const side = this.internalSide(externalSide);
      const context = cityContext(supplied);
      const session = this.currentSession(input.sessionId);
      const candidate = this.selectedCandidate(session[side], context, input.option, 'CITY');
      if (!input.confirmed) {
        this.sessions.save({
          ...session,
          [side]: { ...session[side], status: 'COLLECTING', candidates: [] },
        });
        return this.clarification(session.sessionId, 'Bitte nenne eine andere Stadt oder Gemeinde.');
      }
      const confirmed = this.sessions.confirmCandidate(session.sessionId, side, candidate.id);
      return this.acceptedCity(confirmed, externalSide, side, 'caller_choice');
    });
  }

  public searchAddress(input: AddressSearchDto): Promise<VoiceConversationResponse> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const [externalSide, supplied] = this.side(input);
      const side = this.internalSide(externalSide);
      const context = addressContext(supplied);
      const session = this.sessions.updateAddress(input.sessionId, side, context);
      const state = session[side];
      const streets = await this.resolution.searchAddress(state);
      const geocoded = (await Promise.all(streets.map((candidate) => this.resolution.geocodeAddress(state, candidate))))
        .flat();
      const unique = [...new Map(geocoded.map((candidate) => [
        `${candidate.latitude}:${candidate.longitude}:${candidate.addressLine ?? candidate.displayName}`,
        candidate,
      ])).values()];
      return this.addressResult(session, externalSide, side, context, unique);
    });
  }

  public confirmAddress(input: AddressConfirmDto): Promise<VoiceConversationResponse> {
    return this.sessions.runExclusive(input.sessionId, () => {
      const [externalSide, supplied] = this.side(input);
      const side = this.internalSide(externalSide);
      const context = addressContext(supplied);
      const session = this.currentSession(input.sessionId);
      const candidate = this.selectedCandidate(session[side], context, input.option, 'ADDRESS');
      if (!input.confirmed) {
        this.sessions.save({
          ...session,
          [side]: { ...session[side], status: 'COLLECTING', candidates: [] },
        });
        return this.clarification(session.sessionId, 'Bitte nenne eine andere Straße oder Hausnummer.');
      }
      const confirmed = this.sessions.confirmCandidate(session.sessionId, side, candidate.id);
      return this.acceptedAddress(confirmed, externalSide, side, 'caller_choice');
    });
  }

  public searchRides(input: VoiceRideSearchDto): Promise<VoiceConversationResponse> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const trip = tripContext(input);
      const session = this.currentSession(input.sessionId);
      this.assertTripMatchesSession(session, trip);
      const [result, passenger] = await Promise.all([
        this.mobie.searchRides({
          departure: trip.from,
          destination: trip.destination,
          time: trip.time,
          seatsRequested: trip.seatsRequested,
        }),
        this.mobie.me(),
      ]);
      const passengerId = text(record(passenger)?.id);
      if (!passengerId) throw new HttpError(502, 'Die angemeldete Person konnte nicht eindeutig bestimmt werden.');
      const suggestions = Array.isArray(result) ? result : [];
      const eligible = suggestions
        .map((value) => this.proposal(value, passengerId, trip))
        .filter((value): value is ProposalResult => value !== null);
      const visible = eligible.slice(0, 3);
      this.sessions.save({
        ...session,
        requestedTime: trip.time,
        rideProposals: visible.map(({ storedProposal }) => storedProposal),
      });
      if (eligible.length === 0) {
        return {
          sessionId: session.sessionId,
          status: 'no_rides',
          message: 'Ich habe derzeit keine passende Fahrt gefunden. Möchtest du die Anfrage ändern?',
        };
      }
      const proposals = visible.map(({ publicProposal }, index) => ({ ...publicProposal, option: optionLetters[index] }));
      return {
        sessionId: session.sessionId,
        status: 'ride_proposed',
        message: proposals.length === 1
          ? 'Ich habe eine Fahrt gefunden. Bitte lies die vollständigen Details vor und frage danach gesondert nach der Buchungszustimmung.'
          : `${proposals.length} Fahrten passen. Bitte wähle Option A${proposals.length === 3 ? ', B oder C' : ' oder B'}.`,
        proposals,
        hasMore: eligible.length > 3,
      };
    });
  }

  public confirmBooking(input: BookingConfirmDto): Promise<VoiceConversationResponse> {
    return this.sessions.runExclusive(input.sessionId, async () => {
      const session = this.currentSession(input.sessionId);
      const proposal = session.rideProposals[this.optionIndex(input.option)];
      if (!proposal) throw new HttpError(409, 'Die Fahrt gehört nicht zur aktuellen Suche. Bitte suche erneut.');
      const passengerId = text(record(await this.mobie.me())?.id);
      if (!passengerId || passengerId !== proposal.passengerId) {
        throw new HttpError(409, 'Die Fahrt gehört nicht zur aktuell angemeldeten Person. Bitte suche erneut.');
      }
      if (!input.confirmed) {
        return {
          sessionId: session.sessionId,
          status: 'declined',
          message: 'Okay, ich habe keine Buchungsanfrage gesendet.',
        };
      }
      const consumed = {
        ...session,
        rideProposals: session.rideProposals.filter((item) => item.rideId !== proposal.rideId),
      };
      try {
        const booking = await this.mobie.joinRide(proposal.rideId, {
          departure: proposal.trip.from,
          destination: proposal.trip.destination,
          time: proposal.trip.time,
          seatsRequested: proposal.trip.seatsRequested,
        }, true);
        this.sessions.save(consumed);
        return {
          sessionId: session.sessionId,
          status: 'booking_pending',
          message: 'Deine Anfrage wurde gesendet und wartet auf die Bestätigung durch die Fahrerin oder den Fahrer.',
          booking,
        };
      } catch (error) {
        if (error instanceof HttpError && error.status >= 500) {
          this.sessions.save(consumed);
          return {
            sessionId: session.sessionId,
            status: 'booking_outcome_unknown',
            message: 'Der Ausgang der Buchungsanfrage ist unklar. Bitte prüfe den Status, bevor du erneut sendest.',
          };
        }
        throw error;
      }
    });
  }

  public endCall(sessionId: string): Promise<{ status: 'RESOLVED'; sessionId: string; data: { deleted: boolean } }> {
    return this.sessions.runExclusive(sessionId, () => {
      const normalized = normalize(sessionId);
      return { status: 'RESOLVED', sessionId: normalized, data: { deleted: this.sessions.delete(normalized) } };
    });
  }

  private side<T>(input: SidedRequest<T>): [VoiceAddressSide, T] {
    const supplied: [VoiceAddressSide, T][] = [];
    if (input.from !== undefined) supplied.push(['from', input.from]);
    if (input.destination !== undefined) supplied.push(['destination', input.destination]);
    if (supplied.length !== 1) {
      throw new HttpError(400, 'Genau eines der Felder from oder destination muss angegeben werden.');
    }
    return supplied[0]!;
  }

  private internalSide(side: VoiceAddressSide): AddressSide {
    return side === 'from' ? AddressSide.ORIGIN : AddressSide.DESTINATION;
  }

  private currentSession(sessionId: string): CallSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new HttpError(409, 'Die Sitzung fehlt oder ist abgelaufen. Bitte beginne die Adresssuche erneut.');
    return session;
  }

  private cityResult(
    session: CallSession,
    externalSide: VoiceAddressSide,
    side: AddressSide,
    context: VoiceCityContext,
    candidates: AddressCandidate[],
  ): VoiceConversationResponse {
    if (candidates.length === 0) {
      this.sessions.save({ ...session, [side]: { ...session[side], status: 'COLLECTING', candidates: [] } });
      return this.clarification(session.sessionId, 'Ich konnte die Stadt oder Gemeinde nicht eindeutig finden. Bitte präzisiere die Angabe.');
    }
    const stored = this.sessions.save({
      ...session,
      [side]: {
        ...session[side],
        status: candidates.length === 1 ? 'NEEDS_CONFIRMATION' : 'AMBIGUOUS',
        candidates,
      },
    });
    if (candidates.length === 1) {
      const confirmed = this.sessions.confirmCandidate(stored.sessionId, side, candidates[0]!.id);
      return this.acceptedCity(confirmed, externalSide, side, 'automatic');
    }
    const visible = candidates.slice(0, 3);
    return {
      sessionId: stored.sessionId,
      status: 'needs_selection',
      message: this.selectionMessage(visible),
      candidates: visible.map((candidate, index) => ({
        option: optionLetters[index],
        label: candidate.displayName,
        spokenLabel: candidate.displayName,
        ...this.canonicalCity(candidate, context),
      })),
      hasMore: candidates.length > 3,
    };
  }

  private addressResult(
    session: CallSession,
    externalSide: VoiceAddressSide,
    side: AddressSide,
    context: VoiceAddressContext,
    candidates: AddressCandidate[],
  ): VoiceConversationResponse {
    if (candidates.length === 0) {
      this.sessions.save({ ...session, [side]: { ...session[side], status: 'COLLECTING', candidates: [] } });
      return this.clarification(session.sessionId, 'Ich konnte diese vollständige Adresse nicht eindeutig finden. Bitte prüfe Straße und Hausnummer.');
    }
    const stored = this.sessions.save({
      ...session,
      [side]: {
        ...session[side],
        status: candidates.length === 1 ? 'NEEDS_CONFIRMATION' : 'AMBIGUOUS',
        candidates,
      },
    });
    if (candidates.length === 1) {
      const confirmed = this.sessions.confirmCandidate(stored.sessionId, side, candidates[0]!.id);
      return this.acceptedAddress(confirmed, externalSide, side, 'automatic');
    }
    const visible = candidates.slice(0, 3);
    return {
      sessionId: stored.sessionId,
      status: 'needs_selection',
      message: this.selectionMessage(visible),
      candidates: visible.map((candidate, index) => {
        const canonical = this.canonicalCandidateAddress(candidate, context);
        return {
          option: optionLetters[index],
          label: canonical.addressLine,
          spokenLabel: canonical.addressLine,
          ...canonical,
        };
      }),
      hasMore: candidates.length > 3,
    };
  }

  private acceptedCity(
    session: CallSession,
    externalSide: VoiceAddressSide,
    side: AddressSide,
    selectionMethod: 'automatic' | 'caller_choice',
  ): VoiceConversationResponse {
    const address = session[side];
    if (!address.city) throw new HttpError(409, 'Die ausgewählte Stadt ist nicht mehr verfügbar. Bitte suche erneut.');
    return {
      sessionId: session.sessionId,
      status: 'accepted',
      message: 'Wie lauten Straße und Hausnummer?',
      accepted: { [externalSide]: { postcode: address.postcode ?? '', city: address.city } },
      selectionMethod,
    };
  }

  private acceptedAddress(
    session: CallSession,
    externalSide: VoiceAddressSide,
    side: AddressSide,
    selectionMethod: 'automatic' | 'caller_choice',
  ): VoiceConversationResponse {
    return {
      sessionId: session.sessionId,
      status: 'accepted',
      message: externalSide === 'from' ? 'Die Startadresse wurde übernommen.' : 'Die Zieladresse wurde übernommen.',
      accepted: { [externalSide]: this.canonicalAddress(session[side]) },
      selectionMethod,
    };
  }

  private canonicalCity(candidate: AddressCandidate, context: VoiceCityContext): VoiceCityContext {
    return {
      postcode: candidate.postcode ?? context.postcode,
      city: candidate.city ?? context.city,
    };
  }

  private canonicalCandidateAddress(candidate: AddressCandidate, context: VoiceAddressContext): CanonicalAddress {
    if (candidate.longitude === undefined || candidate.latitude === undefined) {
      throw new HttpError(502, 'Der Geocoding-Anbieter hat keine vollständigen Koordinaten geliefert.');
    }
    return {
      postcode: candidate.postcode ?? context.postcode,
      city: candidate.city ?? context.city,
      street: candidate.street ?? context.street,
      houseNumber: candidate.houseNumber ?? context.houseNumber,
      publicName: candidate.publicName ?? candidate.displayName,
      addressLine: candidate.addressLine ?? candidate.displayName,
      longitude: candidate.longitude,
      latitude: candidate.latitude,
    };
  }

  private canonicalAddress(address: AddressState): CanonicalAddress {
    const location = address.resolvedLocation;
    if (!location || !address.city || !address.street || !address.houseNumber) {
      throw new HttpError(409, 'Die gespeicherte Adresse ist nicht vollständig aufgelöst. Bitte suche erneut.');
    }
    return {
      postcode: address.postcode ?? '',
      city: address.city,
      street: address.street,
      houseNumber: address.houseNumber,
      publicName: location.publicName,
      addressLine: location.addressLine,
      longitude: location.longitude,
      latitude: location.latitude,
    };
  }

  private selectedCandidate(
    address: AddressState,
    context: VoiceCityContext | VoiceAddressContext,
    option: string,
    kind: 'CITY' | 'ADDRESS',
  ): AddressCandidate {
    const storedContext: VoiceCityContext | VoiceAddressContext = kind === 'CITY'
      ? { postcode: address.postcode ?? '', city: address.city ?? '' }
      : {
          postcode: address.postcode ?? '',
          city: address.city ?? '',
          street: address.street ?? '',
          houseNumber: address.houseNumber ?? '',
        };
    const candidate = address.candidates[this.optionIndex(option)];
    if (!candidate || !same(storedContext, context)) {
      throw new HttpError(409, 'Die Auswahl passt nicht mehr zur aktuellen Suche. Bitte suche erneut.');
    }
    if (candidate.kind !== kind) {
      throw new HttpError(409, 'Die Auswahl passt nicht mehr zur aktuellen Suche. Bitte suche erneut.');
    }
    return candidate;
  }

  private optionIndex(option: string): number {
    return optionLetters.indexOf(option as (typeof optionLetters)[number]);
  }

  private assertTripMatchesSession(session: CallSession, trip: VoiceTripContext): void {
    if (
      session.origin.status !== 'CONFIRMED'
      || session.destination.status !== 'CONFIRMED'
      || !same(this.canonicalAddress(session.origin), trip.from)
      || !same(this.canonicalAddress(session.destination), trip.destination)
    ) {
      throw new HttpError(409, 'Die Reisedaten passen nicht mehr zur aktuellen Sitzung. Bitte löse beide Adressen erneut auf.');
    }
  }

  private proposal(value: unknown, passengerId: string, trip: VoiceTripContext): ProposalResult | null {
    const suggestion = record(value);
    const ride = record(suggestion?.ride);
    const rideId = text(ride?.id);
    if (!suggestion || !ride || !rideId) return null;
    const driver = record(suggestion.driver);
    const pickup = record(suggestion.pickup) ?? record(suggestion.pickupLocation);
    const pickupTime = text(suggestion.pickupEta) ?? text(suggestion.pickupTime);
    const driverDepartureTime = text(ride.time);
    const pickupAddress = text(suggestion.pickupAddress) ?? text(pickup?.addressLine) ?? text(pickup?.publicName);
    const firstName = text(driver?.firstName);
    const lastName = text(driver?.lastName);
    const availableSeats = finite(suggestion.availableSeats) ?? finite(ride.availableSeats);
    const commercialFields = Object.fromEntries([
      'estimatedPriceInCents',
      'estimatedPrice',
      'finalPriceInCents',
      'requiresPayment',
      'compensationMode',
      'calculatedPrice',
      'platformPriceEstimate',
      'chargedPrice',
      'payableAmount',
    ].flatMap((key) => {
      const field = suggestion[key] ?? ride[key];
      return typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean' ? [[key, field]] : [];
    }));
    const driverDetails = firstName || lastName
      ? { ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}) }
      : undefined;
    const spokenLabel = [pickupTime ? `Abholung ${pickupTime}` : undefined, firstName ? `mit ${firstName}` : undefined]
      .filter(Boolean).join(', ') || 'Fahrt';
    return {
      storedProposal: { rideId, passengerId, trip },
      publicProposal: {
        spokenLabel,
        from: trip.from,
        destination: trip.destination,
        time: trip.time,
        seatsRequested: trip.seatsRequested,
        ...(pickupTime ? { pickupTime } : {}),
        ...(driverDepartureTime ? { driverDepartureTime } : {}),
        ...(pickupAddress ? { pickupAddress } : {}),
        ...(driverDetails ? { driver: driverDetails } : {}),
        ...(availableSeats === undefined ? {} : { availableSeats }),
        ...commercialFields,
      },
    };
  }

  private selectionMessage(candidates: AddressCandidate[]): string {
    const labels = candidates.map((candidate, index) => `Option ${optionLetters[index]}: ${candidate.displayName}`);
    return `${labels.join('. ')}. Welche Option meinst du?`;
  }

  private clarification(sessionId: string, message: string): VoiceConversationResponse {
    return { sessionId, status: 'needs_clarification', message };
  }
}
