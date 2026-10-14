export interface TripSearchStrings {
  readonly departure: unknown;
  readonly destination: unknown;
  readonly time: unknown;
  readonly seatsRequested?: unknown;
}

export interface ProcessedTripSearch {
  readonly departure: string;
  readonly destination: string;
  readonly time: string;
  readonly seatsRequested: number;
}
