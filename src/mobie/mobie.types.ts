export interface LocationById {
  readonly id: string;
}

export interface CoordinatesLocation {
  readonly longitude: number;
  readonly latitude: number;
  readonly publicName?: string;
  readonly addressLine?: string;
}

export type MobieLocation = LocationById | CoordinatesLocation;

export interface RidePayload {
  readonly departure: MobieLocation;
  readonly destination: MobieLocation;
  readonly time: string;
  readonly seatsRequested: number;
}
