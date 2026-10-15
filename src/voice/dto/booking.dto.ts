import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { VoiceRideSearchDto } from './ride-search.dto.js';

export class VoiceBookingDto extends VoiceRideSearchDto {
  @IsOptional()
  @IsString({ message: 'proposalToken must be a non-empty string.' })
  @Matches(/\S/, { message: 'proposalToken must be a non-empty string.' })
  @MaxLength(128, { message: 'proposalToken must be at most 128 characters.' })
  public proposalToken?: string;

  @IsOptional()
  @IsString({ message: 'rideId must be a non-empty string.' })
  @Matches(/\S/, { message: 'rideId must be a non-empty string.' })
  @MaxLength(128, { message: 'rideId must be at most 128 characters.' })
  public rideId?: string;

  @IsIn([true, false, 'true', 'false'], { message: 'confirmed must be true or false.' })
  public confirmed!: boolean | 'true' | 'false';

  @IsOptional()
  @IsString({ message: 'reply must be a string of at most 500 characters.' })
  @MaxLength(500, { message: 'reply must be a string of at most 500 characters.' })
  public reply?: string;
}
