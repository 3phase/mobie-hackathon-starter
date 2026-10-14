import type { VoiceTripContext } from '../guided-booking.types.js';

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
  readonly kind: CandidateKind;
  readonly city?: string;
  readonly postcode?: string;
  readonly street?: string;
  readonly houseNumber?: string;
  readonly locality?: string;
  readonly municipalityKey?: string;
  readonly localityKey?: string;
  readonly streetKey?: string;
  readonly publicName?: string;
  readonly addressLine?: string;
}

export interface ResolvedLocation {
  readonly displayName: string;
  readonly publicName: string;
  readonly addressLine: string;
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
  readonly resolvedLocation?: ResolvedLocation;
}

export interface StoredRideProposal {
  readonly rideId: string;
  readonly passengerId: string;
  readonly trip: VoiceTripContext;
}

export interface CallSession {
  readonly sessionId: string;
  readonly origin: AddressState;
  readonly destination: AddressState;
  readonly rideProposals: StoredRideProposal[];
  readonly requestedTime?: string;
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
  | 'INTEGRATION_UNAVAILABLE';

export interface VoiceApiResponse<T = unknown> {
  readonly status: VoiceStatus;
  readonly sessionId: string;
  readonly side?: AddressSide;
  readonly data?: T;
  readonly candidates?: PublicAddressCandidate[];
  readonly clarificationQuestion?: string;
}

export type PublicAddressCandidate = Omit<
  AddressCandidate,
  'kind' | 'city' | 'postcode' | 'street' | 'houseNumber' | 'locality' | 'municipalityKey' | 'localityKey' | 'streetKey'
>;

export function publicCandidate(candidate: AddressCandidate): PublicAddressCandidate {
  return {
    id: candidate.id,
    displayName: candidate.displayName,
    ...(candidate.score === undefined ? {} : { score: candidate.score }),
    ...(candidate.latitude === undefined ? {} : { latitude: candidate.latitude }),
    ...(candidate.longitude === undefined ? {} : { longitude: candidate.longitude }),
    ...(candidate.externalId ? { externalId: candidate.externalId } : {}),
    ...(candidate.publicName ? { publicName: candidate.publicName } : {}),
    ...(candidate.addressLine ? { addressLine: candidate.addressLine } : {}),
  };
}
