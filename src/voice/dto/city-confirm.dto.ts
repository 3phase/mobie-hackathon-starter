import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { SidedVoiceRequestDto } from './voice-request.dto.js';

export class CityConfirmDto extends SidedVoiceRequestDto {
  @IsOptional()
  @IsString({ message: 'candidateId must be a non-empty string.' })
  @Matches(/\S/, { message: 'candidateId must be a non-empty string.' })
  @MaxLength(128, { message: 'candidateId must be at most 128 characters.' })
  public candidateId?: string;

  @IsOptional()
  @IsString({ message: 'candidateToken must be a non-empty string.' })
  @Matches(/\S/, { message: 'candidateToken must be a non-empty string.' })
  @MaxLength(128, { message: 'candidateToken must be at most 128 characters.' })
  public candidateToken?: string;

  @IsOptional()
  @IsIn([true, false, 'true', 'false'], { message: 'confirmed must be true or false.' })
  public confirmed?: boolean | 'true' | 'false';

  @IsOptional()
  @IsString({ message: 'reply must be a string of at most 500 characters.' })
  @MaxLength(500, { message: 'reply must be a string of at most 500 characters.' })
  public reply?: string;
}
