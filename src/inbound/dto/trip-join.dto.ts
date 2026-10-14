import { IsDefined, IsString, Matches } from 'class-validator';

export class TripJoinDto {
  @IsDefined({ message: 'rideId must be a non-empty string.' })
  @IsString({ message: 'rideId must be a non-empty string.' })
  @Matches(/\S/, { message: 'rideId must be a non-empty string.' })
  public rideId!: string;
}
