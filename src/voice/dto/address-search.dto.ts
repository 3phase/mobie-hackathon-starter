import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { SidedVoiceRequestDto } from './voice-request.dto.js';

export class AddressSearchDto extends SidedVoiceRequestDto {
  @IsOptional()
  @IsString({ message: 'postcode must be an Austrian four-digit string or blank.' })
  @Matches(/^\s*$|^\s*\d{4}\s*$/, { message: 'postcode must be an Austrian four-digit string or blank.' })
  public postcode?: string;

  @IsOptional()
  @IsString({ message: 'city must be a string of at most 160 characters.' })
  @MaxLength(160, { message: 'city must be a string of at most 160 characters.' })
  public city?: string;

  @IsOptional()
  @IsString({ message: 'street must be a string of at most 200 characters.' })
  @Matches(/\S/, { message: 'street must not be blank.' })
  @MaxLength(200, { message: 'street must be a string of at most 200 characters.' })
  public street?: string;

  @IsOptional()
  @IsString({ message: 'houseNumber must be a string of at most 32 characters.' })
  @Matches(/\S/, { message: 'houseNumber must not be blank.' })
  @MaxLength(32, { message: 'houseNumber must be a string of at most 32 characters.' })
  public houseNumber?: string;
}
