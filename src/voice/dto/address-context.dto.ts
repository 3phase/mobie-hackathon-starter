import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VoiceRequestDto } from './voice-request.dto.js';

const optionalPostcode = /^(?:\s*|\s*\d{4}\s*)$/;

export class PostcodeContextDto {
  @IsString({ message: 'postcode muss eine österreichische vierstellige Postleitzahl sein.' })
  @Matches(/^\s*\d{4}\s*$/, { message: 'postcode muss eine österreichische vierstellige Postleitzahl sein.' })
  public postcode!: string;
}

export class CityContextDto {
  @IsOptional()
  @IsString({ message: 'postcode muss leer oder eine österreichische vierstellige Postleitzahl sein.' })
  @Matches(optionalPostcode, { message: 'postcode muss leer oder eine österreichische vierstellige Postleitzahl sein.' })
  public postcode?: string;

  @IsString({ message: 'city muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @Matches(/\S/, { message: 'city muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @MaxLength(256, { message: 'city muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  public city!: string;
}

export class AddressContextDto extends CityContextDto {
  @IsString({ message: 'street muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @Matches(/\S/, { message: 'street muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @MaxLength(256, { message: 'street muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  public street!: string;

  @IsString({ message: 'houseNumber muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @Matches(/\S/, { message: 'houseNumber muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @MaxLength(256, { message: 'houseNumber muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  public houseNumber!: string;
}

export class ResolvedAddressContextDto extends AddressContextDto {
  @IsString({ message: 'publicName muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @Matches(/\S/, { message: 'publicName muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @MaxLength(256, { message: 'publicName muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  public publicName!: string;

  @IsString({ message: 'addressLine muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @Matches(/\S/, { message: 'addressLine muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  @MaxLength(256, { message: 'addressLine muss eine nicht leere Zeichenfolge mit höchstens 256 Zeichen sein.' })
  public addressLine!: string;

  @IsDefined({ message: 'longitude ist erforderlich.' })
  @IsNumber({}, { message: 'longitude muss eine Zahl zwischen -180 und 180 sein.' })
  @IsLongitude({ message: 'longitude muss eine Zahl zwischen -180 und 180 sein.' })
  public longitude!: number;

  @IsDefined({ message: 'latitude ist erforderlich.' })
  @IsNumber({}, { message: 'latitude muss eine Zahl zwischen -90 und 90 sein.' })
  @IsLatitude({ message: 'latitude muss eine Zahl zwischen -90 und 90 sein.' })
  public latitude!: number;
}

export class ResolvedTripContextDto extends VoiceRequestDto {
  @IsDefined({ message: 'from ist erforderlich.' })
  @ValidateNested()
  @Type(() => ResolvedAddressContextDto)
  public from!: ResolvedAddressContextDto;

  @IsDefined({ message: 'destination ist erforderlich.' })
  @ValidateNested()
  @Type(() => ResolvedAddressContextDto)
  public destination!: ResolvedAddressContextDto;

  @IsString({ message: 'time muss ein ISO-8601-Zeitpunkt mit Z oder explizitem Offset sein.' })
  @Matches(/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/, {
    message: 'time muss ein ISO-8601-Zeitpunkt mit Z oder explizitem Offset sein.',
  })
  @MaxLength(64, { message: 'time muss ein ISO-8601-Zeitpunkt mit Z oder explizitem Offset sein.' })
  public time!: string;

  @IsInt({ message: 'seatsRequested muss eine ganze Zahl zwischen 1 und 8 sein.' })
  @Min(1, { message: 'seatsRequested muss eine ganze Zahl zwischen 1 und 8 sein.' })
  @Max(8, { message: 'seatsRequested muss eine ganze Zahl zwischen 1 und 8 sein.' })
  public seatsRequested!: number;
}
