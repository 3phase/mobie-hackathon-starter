import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';
import { AddressSide } from '../session/call-session.types.js';

export class VoiceRequestDto {
  @IsString({ message: 'sessionId must be a non-empty string of at most 256 characters.' })
  @Matches(/\S/, { message: 'sessionId must be a non-empty string of at most 256 characters.' })
  @MaxLength(256, { message: 'sessionId must be a non-empty string of at most 256 characters.' })
  public sessionId!: string;
}

export class SidedVoiceRequestDto extends VoiceRequestDto {
  @IsEnum(AddressSide, { message: 'side must be either origin or destination.' })
  public side!: AddressSide;
}
