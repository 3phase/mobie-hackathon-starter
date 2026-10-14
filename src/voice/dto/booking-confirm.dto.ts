import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';
import { VoiceRequestDto } from './voice-request.dto.js';

export class BookingConfirmDto extends VoiceRequestDto {
  @IsString({ message: 'option muss A, B oder C sein.' })
  @Matches(/^[ABC]$/, { message: 'option muss A, B oder C sein.' })
  public option!: string;

  @IsBoolean({ message: 'confirmed muss ein boolescher Wert sein.' })
  public confirmed!: boolean;

  @IsString({ message: 'reply muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @Matches(/\S/, { message: 'reply muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @MaxLength(256, { message: 'reply muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  public reply!: string;
}
