import { Type } from 'class-transformer';
import { IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { FonioAddressContextDto, VoiceRequestDto } from './voice-request.dto.js';

export class VoiceRideSearchDto extends VoiceRequestDto {
  @IsOptional()
  @IsString({ message: 'requestedTime must be an ISO-8601 datetime.' })
  @Matches(/\S/, { message: 'requestedTime must be an ISO-8601 datetime.' })
  @MaxLength(64, { message: 'requestedTime must be an ISO-8601 datetime.' })
  public requestedTime?: string;

  @IsOptional()
  @IsString({ message: 'time must be an ISO-8601 datetime.' })
  @Matches(/\S/, { message: 'time must be an ISO-8601 datetime.' })
  @MaxLength(64, { message: 'time must be an ISO-8601 datetime.' })
  public time?: string;

  @IsOptional()
  public seatsRequested?: unknown;

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
