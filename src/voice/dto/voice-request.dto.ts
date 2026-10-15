import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AddressSide } from '../session/call-session.types.js';

export class FonioAddressContextDto {
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
  @MaxLength(200, { message: 'street must be a string of at most 200 characters.' })
  public street?: string;

  @IsOptional()
  @IsString({ message: 'houseNumber must be a string of at most 32 characters.' })
  @MaxLength(32, { message: 'houseNumber must be a string of at most 32 characters.' })
  public houseNumber?: string;

  @IsOptional()
  @IsString({ message: 'publicName must be a string of at most 500 characters.' })
  @MaxLength(500, { message: 'publicName must be a string of at most 500 characters.' })
  public publicName?: string;

  @IsOptional()
  @IsString({ message: 'addressLine must be a string of at most 500 characters.' })
  @MaxLength(500, { message: 'addressLine must be a string of at most 500 characters.' })
  public addressLine?: string;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false }, { message: 'longitude must be a number.' })
  public longitude?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false }, { message: 'latitude must be a number.' })
  public latitude?: number;
}

export class VoiceRequestDto {
  @IsString({ message: 'sessionId must be a non-empty string of at most 256 characters.' })
  @Matches(/\S/, { message: 'sessionId must be a non-empty string of at most 256 characters.' })
  @MaxLength(256, { message: 'sessionId must be a non-empty string of at most 256 characters.' })
  public sessionId!: string;
}

export class SidedVoiceRequestDto extends VoiceRequestDto {
  @IsOptional()
  @IsEnum(AddressSide, { message: 'side must be either origin or destination.' })
  public side?: AddressSide;

  @IsOptional()
  @IsObject({ message: 'from must be an address object.' })
  @ValidateNested()
  @Type(() => FonioAddressContextDto)
  public from?: FonioAddressContextDto;

  @IsOptional()
  @IsObject({ message: 'destination must be an address object.' })
  @ValidateNested()
  @Type(() => FonioAddressContextDto)
  public destination?: FonioAddressContextDto;
}
