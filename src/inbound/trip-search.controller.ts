import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { JsonContentTypeGuard } from '../common/guards/json-content-type.guard.js';
import { TripJoinDto } from './dto/trip-join.dto.js';
import { TripSearchDto } from './dto/trip-search.dto.js';
import type { FonioTripSearchResponse } from './fonio-trip-search-response.js';
import { TripSearchService } from './trip-search.service.js';

@Controller('api/trips')
export class TripSearchController {
  public constructor(@Inject(TripSearchService) private readonly trips: TripSearchService) {}

  @Post('search')
  @HttpCode(200)
  @UseGuards(JsonContentTypeGuard)
  public search(@Body() body: TripSearchDto): Promise<FonioTripSearchResponse> {
    return this.trips.search(body);
  }

  @Post('join')
  @HttpCode(200)
  @UseGuards(JsonContentTypeGuard)
  public join(@Body() body: TripJoinDto): Promise<unknown> {
    return this.trips.join(body.rideId);
  }

  @Get('latest')
  public latest() {
    return this.trips.latest();
  }
}
