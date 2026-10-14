import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { CityContextDto } from './address-context.dto.js';
import { VoiceRequestDto } from './voice-request.dto.js';

export class CitySearchDto extends VoiceRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CityContextDto)
  public from?: CityContextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CityContextDto)
  public destination?: CityContextDto;
}
