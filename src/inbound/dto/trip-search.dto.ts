import { IsDefined, IsOptional } from 'class-validator';

export class TripSearchDto {
  @IsDefined({ message: 'departure must be a string.' })
  public departure!: unknown;

  @IsDefined({ message: 'destination must be a string.' })
  public destination!: unknown;

  @IsDefined({ message: 'time must be an ISO-8601 datetime; values without an offset are interpreted in Europe/Vienna.' })
  public time!: unknown;

  @IsOptional()
  public seatsRequested?: unknown;
}
