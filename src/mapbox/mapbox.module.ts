import { Module } from '@nestjs/common';
import { MapboxClient } from './mapbox.client.js';
import { MapboxController } from './mapbox.controller.js';
import { MapboxService } from './mapbox.service.js';

@Module({
  controllers: [MapboxController],
  providers: [MapboxClient, MapboxService],
  exports: [MapboxService],
})
export class MapboxModule {}
