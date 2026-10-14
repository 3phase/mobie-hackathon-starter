import { IsString, Matches } from 'class-validator';
import { SidedVoiceRequestDto } from './voice-request.dto.js';

export class PostcodeSearchDto extends SidedVoiceRequestDto {
  @IsString({ message: 'postcode must be an Austrian four-digit string.' })
  @Matches(/^\s*\d{4}\s*$/, { message: 'postcode must be an Austrian four-digit string.' })
  public postcode!: string;
}
