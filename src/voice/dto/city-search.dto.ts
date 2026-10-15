import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { SidedVoiceRequestDto } from './voice-request.dto.js';

export class CitySearchDto extends SidedVoiceRequestDto {
  @IsOptional()
  @IsString({ message: 'city must be a non-empty string of at most 160 characters.' })
  @Matches(/\S/, { message: 'city must be a non-empty string of at most 160 characters.' })
  @MaxLength(160, { message: 'city must be a non-empty string of at most 160 characters.' })
  public city?: string;
}
