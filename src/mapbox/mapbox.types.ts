export interface LocationCandidate {
  readonly publicName: string;
  readonly addressLine: string;
  readonly longitude: number;
  readonly latitude: number;
}

export interface LocationSearchResult {
  readonly candidates: LocationCandidate[];
  readonly attribution: string;
}
