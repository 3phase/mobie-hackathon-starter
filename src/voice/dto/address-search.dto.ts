import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { AddressContextDto } from './address-context.dto.js';
import { VoiceRequestDto } from './voice-request.dto.js';

export class AddressSearchDto extends VoiceRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressContextDto)
  public from?: AddressContextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressContextDto)
  public destination?: AddressContextDto;
}
