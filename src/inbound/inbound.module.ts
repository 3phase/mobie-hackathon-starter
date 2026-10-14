import { Module } from '@nestjs/common';
import { MapboxModule } from '../mapbox/mapbox.module.js';
import { MobieModule } from '../mobie/mobie.module.js';
import { StringProcessingModule } from '../string-processing/string-processing.module.js';
import { AddressReceiptController } from './address-receipt.controller.js';
import { AddressReceiptService } from './address-receipt.service.js';
import { HealthController } from './health.controller.js';
import { NotFoundController } from './not-found.controller.js';
import { StaticController } from './static.controller.js';
import { TripSearchController } from './trip-search.controller.js';
import { TripSearchService } from './trip-search.service.js';

@Module({
  imports: [StringProcessingModule, MapboxModule, MobieModule],
  controllers: [
    HealthController,
    StaticController,
    AddressReceiptController,
    TripSearchController,
    NotFoundController
  ],
  providers: [AddressReceiptService, TripSearchService],
})
export class InboundModule { }
