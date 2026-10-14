export type VoiceAddressSide = 'from' | 'destination';

export interface VoiceCityContext {
  readonly postcode: string;
  readonly city: string;
}

export interface VoiceAddressContext extends VoiceCityContext {
  readonly street: string;
  readonly houseNumber: string;
}

export interface CanonicalAddress extends VoiceAddressContext {
  readonly publicName: string;
  readonly addressLine: string;
  readonly longitude: number;
  readonly latitude: number;
}

export interface VoiceTripContext {
  readonly from: CanonicalAddress;
  readonly destination: CanonicalAddress;
  readonly time: string;
  readonly seatsRequested: number;
}

export type VoiceConversationStatus =
  | 'accepted'
  | 'needs_clarification'
  | 'needs_selection'
  | 'ride_proposed'
  | 'no_rides'
  | 'declined'
  | 'booking_pending'
  | 'booking_outcome_unknown';

export interface VoiceConversationResponse {
  readonly sessionId: string;
  readonly status: VoiceConversationStatus;
  readonly message: string;
  readonly [key: string]: unknown;
}
