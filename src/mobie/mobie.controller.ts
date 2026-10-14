import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { JsonContentTypeGuard } from '../common/guards/json-content-type.guard.js';
import { JoinRideDto, RideRequestDto } from './dto/ride-request.dto.js';
import { MobieService } from './mobie.service.js';

@Controller('api')
export class MobieController {
  public constructor(@Inject(MobieService) private readonly mobie: MobieService) {}

  @Get('me')
  public me() {
    return this.mobie.me();
  }

  @Post('rides/search')
  @HttpCode(200)
  @UseGuards(JsonContentTypeGuard)
  public search(@Body() body: RideRequestDto) {
    return this.mobie.searchRides(body);
  }

  @Post('rides/:id/join-detailed')
  @HttpCode(200)
  @UseGuards(JsonContentTypeGuard)
  public join(@Param('id') id: string, @Body() body: JoinRideDto) {
    const { confirmed, ...payload } = body;
    return this.mobie.joinRide(id, payload, confirmed);
  }

  @Get('rides/:id/rider-detail')
  public riderDetail(@Param('id') id: string) {
    return this.mobie.riderRideDetails(id);
  }

  @Get('rides/:id')
  public driverDetail(@Param('id') id: string) {
    return this.mobie.driverRideDetails(id);
  }
}
