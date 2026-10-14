import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { JsonContentTypeGuard } from '../common/guards/json-content-type.guard.js';
import { TripSearchService } from '../inbound/trip-search.service.js';
import { AddressConfirmDto } from './dto/address-confirm.dto.js';
import { AddressSearchDto } from './dto/address-search.dto.js';
import { CallEndDto } from './dto/call-end.dto.js';
import { CityConfirmDto } from './dto/city-confirm.dto.js';
import { CitySearchDto } from './dto/city-search.dto.js';
import { PostcodeSearchDto } from './dto/postcode-search.dto.js';
import { VoiceRideSearchDto } from './dto/ride-search.dto.js';
import { TripJoinDto } from '../inbound/dto/trip-join.dto.js';
import { VoiceOrchestrationService } from './services/voice-orchestration.service.js';

@Controller('api/voice')
@UseGuards(JsonContentTypeGuard)
export class VoiceController {
  public constructor(@Inject(VoiceOrchestrationService) private readonly voice: VoiceOrchestrationService) {}

  @Post('postcodes/search')
  @HttpCode(200)
  public searchPostcode(@Body() body: PostcodeSearchDto) {
    return this.voice.searchPostcode(body);
  }

  @Post('cities/search')
  @HttpCode(200)
  public searchCity(@Body() body: CitySearchDto) {
    return this.voice.searchCity(body);
  }

  @Post('cities/confirm')
  @HttpCode(200)
  public confirmCity(@Body() body: CityConfirmDto) {
    return this.voice.confirmCity(body);
  }

  @Post('addresses/search')
  @HttpCode(200)
  public searchAddress(@Body() body: AddressSearchDto) {
    return this.voice.searchAddress(body);
  }

  @Post('addresses/confirm')
  @HttpCode(200)
  public confirmAddress(@Body() body: AddressConfirmDto) {
    return this.voice.confirmAddress(body);
  }

  @Post('rides/search')
  @HttpCode(200)
  public searchRides(@Body() body: VoiceRideSearchDto) {
    return this.voice.searchRides(body);
  }

  @Post('sessions/end')
  @HttpCode(200)
  public endCall(@Body() body: CallEndDto) {
    return this.voice.endCall(body.callId);
  }
}

@Controller('ride')
export class VoiceBookingController {
  public constructor(@Inject(TripSearchService) private readonly trips: TripSearchService) {}

  @Post('join')
  @HttpCode(200)
  @UseGuards(JsonContentTypeGuard)
  public join(@Body() body: TripJoinDto): Promise<unknown> {
    return this.trips.join(body.rideId);
  }
}
