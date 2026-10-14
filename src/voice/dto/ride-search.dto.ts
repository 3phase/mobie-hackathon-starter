import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { VoiceRequestDto } from './voice-request.dto.js';

export class VoiceRideSearchDto extends VoiceRequestDto {
  @IsString({ message: 'requestedTime must be an ISO-8601 datetime.' })
  @Matches(/\S/, { message: 'requestedTime must be an ISO-8601 datetime.' })
  @MaxLength(64, { message: 'requestedTime must be an ISO-8601 datetime.' })
  public requestedTime!: string;

  @IsOptional()
  public seatsRequested?: unknown;
}
