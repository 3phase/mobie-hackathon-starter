import { IsDefined, IsOptional } from 'class-validator';

export class RideRequestDto {
  @IsDefined({ message: 'departure must be a location object.' })
  public departure!: unknown;

  @IsDefined({ message: 'destination must be a location object.' })
  public destination!: unknown;

  @IsDefined({ message: 'time must be an ISO-8601 datetime with Z or an explicit offset (e.g. +02:00).' })
  public time!: unknown;

  @IsOptional()
  public seatsRequested?: unknown;
}

export class JoinRideDto extends RideRequestDto {
  @IsOptional()
  public confirmed?: unknown;
}
