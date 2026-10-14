import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { JsonContentTypeGuard } from '../common/guards/json-content-type.guard.js';
import { LocationSearchDto } from './dto/location-search.dto.js';
import { MapboxService } from './mapbox.service.js';

@Controller('api/locations')
export class MapboxController {
  public constructor(@Inject(MapboxService) private readonly mapbox: MapboxService) {}

  @Post('search')
  @HttpCode(200)
  @UseGuards(JsonContentTypeGuard)
  public search(@Body() body: LocationSearchDto) {
    return this.mapbox.searchLocations(body.query);
  }
}
