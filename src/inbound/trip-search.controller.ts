import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { JsonContentTypeGuard } from '../common/guards/json-content-type.guard.js';
import { TripSearchDto } from './dto/trip-search.dto.js';
import { TripSearchService } from './trip-search.service.js';

@Controller('api/trips')
export class TripSearchController {
  public constructor(@Inject(TripSearchService) private readonly trips: TripSearchService) {}

  @Post('search')
  @HttpCode(200)
  @UseGuards(JsonContentTypeGuard)
  public search(@Body() body: TripSearchDto) {
    return this.trips.search(body);
  }

  @Get('latest')
  public latest() {
    return this.trips.latest();
  }
}
