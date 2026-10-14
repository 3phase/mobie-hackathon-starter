import { IsString, Matches, MaxLength } from 'class-validator';
import { SidedVoiceRequestDto } from './voice-request.dto.js';

export class CityConfirmDto extends SidedVoiceRequestDto {
  @IsString({ message: 'candidateId must be a non-empty string.' })
  @Matches(/\S/, { message: 'candidateId must be a non-empty string.' })
  @MaxLength(128, { message: 'candidateId must be at most 128 characters.' })
  public candidateId!: string;
}
