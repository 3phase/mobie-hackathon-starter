import { IsString, Matches, MaxLength } from 'class-validator';

export class VoiceRequestDto {
  @IsString({ message: 'sessionId muss eine nicht leere Zeichenfolge mit höchstens 2048 Zeichen sein.' })
  @Matches(/\S/, { message: 'sessionId muss eine nicht leere Zeichenfolge mit höchstens 2048 Zeichen sein.' })
  @MaxLength(2048, { message: 'sessionId muss eine nicht leere Zeichenfolge mit höchstens 2048 Zeichen sein.' })
  public sessionId!: string;
}
