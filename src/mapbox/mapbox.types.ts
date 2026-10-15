export interface LocationCandidate {
  readonly publicName: string;
  readonly addressLine: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly externalId?: string;
  readonly featureType?: string;
  readonly postcode?: string;
  readonly city?: string;
  readonly street?: string;
  readonly houseNumber?: string;
  readonly matchCode?: Readonly<Record<string, string>>;
}

export interface LocationSearchResult {
  readonly candidates: LocationCandidate[];
  readonly attribution: string;
}

export interface StructuredAddressQuery {
  readonly street: string;
  readonly houseNumber: string;
  readonly postcode: string;
  readonly city: string;
}
