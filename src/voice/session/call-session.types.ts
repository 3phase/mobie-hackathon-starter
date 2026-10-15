export enum AddressSide {
  ORIGIN = 'origin',
  DESTINATION = 'destination',
}

export type ResolutionStatus = 'COLLECTING' | 'AMBIGUOUS' | 'NEEDS_CONFIRMATION' | 'CONFIRMED';

export type CandidateKind = 'CITY' | 'ADDRESS';

export interface AddressCandidate {
  readonly id: string;
  readonly displayName: string;
  readonly score?: number;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly externalId?: string;
  /** Internal metadata used to apply a confirmed candidate safely. */
  readonly kind: CandidateKind;
  readonly city?: string;
  readonly postcode?: string;
  readonly street?: string;
  readonly locality?: string;
  readonly municipalityKey?: string;
  readonly localityKey?: string;
  readonly streetKey?: string;
}

export interface ResolvedLocation {
  readonly displayName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly externalId?: string;
}

export interface AddressState {
  readonly postcode?: string;
  readonly city?: string;
  readonly locality?: string;
  readonly municipalityKey?: string;
  readonly localityKey?: string;
  readonly street?: string;
  readonly streetKey?: string;
  readonly houseNumber?: string;
  readonly status: ResolutionStatus;
  readonly candidates: AddressCandidate[];
  /** Candidate token that produced the currently confirmed address, for idempotent Fonio retries. */
  readonly confirmedCandidateToken?: string;
  readonly resolvedLocation?: ResolvedLocation;
}

export interface CallSession {
  readonly sessionId: string;
  readonly origin: AddressState;
  readonly destination: AddressState;
  readonly requestedTime?: string;
  readonly seatsRequested?: number;
  readonly selectedRide?: {
    readonly rideId: string;
    readonly proposalToken: string;
  };
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AddressPatch {
  readonly postcode?: string;
  readonly city?: string;
  readonly locality?: string;
  readonly municipalityKey?: string;
  readonly localityKey?: string;
  readonly street?: string;
  readonly streetKey?: string;
  readonly houseNumber?: string;
}

export type VoiceStatus =
  | 'COLLECTING'
  | 'RESOLVED'
  | 'NEEDS_CLARIFICATION'
  | 'NEEDS_CONFIRMATION'
  | 'NOT_FOUND'
  | 'INVALID_CONTEXT'
  | 'INTEGRATION_UNAVAILABLE'
  | 'DECLINED'
  | 'PENDING_BOOKING';

export interface VoiceApiResponse<T = unknown> {
  readonly status: VoiceStatus;
  readonly sessionId: string;
  readonly side?: AddressSide;
  readonly data?: T;
  readonly candidates?: PublicAddressCandidate[];
  readonly proposalToken?: string;
  readonly clarificationQuestion?: string;
}

export type PublicAddressCandidate = Omit<
  AddressCandidate,
  'kind' | 'city' | 'postcode' | 'street' | 'locality' | 'municipalityKey' | 'localityKey' | 'streetKey'
> & {
  readonly candidateToken: string;
  readonly optionLabel?: string;
};

export function publicCandidate(candidate: AddressCandidate, optionIndex?: number): PublicAddressCandidate {
  return {
    id: candidate.id,
    candidateToken: candidate.id,
    ...(optionIndex === undefined ? {} : { optionLabel: `option ${String.fromCharCode(65 + optionIndex)}` }),
    displayName: candidate.displayName,
    ...(candidate.score === undefined ? {} : { score: candidate.score }),
    ...(candidate.latitude === undefined ? {} : { latitude: candidate.latitude }),
    ...(candidate.longitude === undefined ? {} : { longitude: candidate.longitude }),
    ...(candidate.externalId ? { externalId: candidate.externalId } : {}),
  };
}
