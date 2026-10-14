import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';
import { AddressSide } from '../session/call-session.types.js';

export class VoiceRequestDto {
  @IsString({ message: 'callId must be a non-empty string of at most 256 characters.' })
  @Matches(/\S/, { message: 'callId must be a non-empty string of at most 256 characters.' })
  @MaxLength(256, { message: 'callId must be a non-empty string of at most 256 characters.' })
  public callId!: string;
}

export class SidedVoiceRequestDto extends VoiceRequestDto {
  @IsEnum(AddressSide, { message: 'side must be either origin or destination.' })
  public side!: AddressSide;
}
