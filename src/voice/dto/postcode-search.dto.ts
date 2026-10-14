import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { PostcodeContextDto } from './address-context.dto.js';
import { VoiceRequestDto } from './voice-request.dto.js';

export class PostcodeSearchDto extends VoiceRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PostcodeContextDto)
  public from?: PostcodeContextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PostcodeContextDto)
  public destination?: PostcodeContextDto;
}
