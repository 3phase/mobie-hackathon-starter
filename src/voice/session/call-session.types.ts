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
  readonly street?: string;
  readonly houseNumber?: string;
  readonly status: ResolutionStatus;
  readonly candidates: AddressCandidate[];
  readonly resolvedLocation?: ResolvedLocation;
}

export interface CallSession {
  readonly callId: string;
  readonly origin: AddressState;
  readonly destination: AddressState;
  readonly requestedTime?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AddressPatch {
  readonly postcode?: string;
  readonly city?: string;
  readonly street?: string;
  readonly houseNumber?: string;
}

export type VoiceStatus =
  | 'COLLECTING'
  | 'RESOLVED'
  | 'NEEDS_CLARIFICATION'
  | 'NEEDS_CONFIRMATION'
  | 'NOT_FOUND'
  | 'INVALID_CONTEXT'
  | 'INTEGRATION_UNAVAILABLE';

export interface VoiceApiResponse<T = unknown> {
  readonly status: VoiceStatus;
  readonly callId: string;
  readonly side?: AddressSide;
  readonly data?: T;
  readonly candidates?: PublicAddressCandidate[];
  readonly clarificationQuestion?: string;
}

export type PublicAddressCandidate = Omit<AddressCandidate, 'kind' | 'city' | 'postcode'>;

export function publicCandidate(candidate: AddressCandidate): PublicAddressCandidate {
  return {
    id: candidate.id,
    displayName: candidate.displayName,
    ...(candidate.score === undefined ? {} : { score: candidate.score }),
    ...(candidate.latitude === undefined ? {} : { latitude: candidate.latitude }),
    ...(candidate.longitude === undefined ? {} : { longitude: candidate.longitude }),
    ...(candidate.externalId ? { externalId: candidate.externalId } : {}),
  };
}
