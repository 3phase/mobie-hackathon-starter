import { Module } from '@nestjs/common';
import { AddressReceiptController } from './address-receipt.controller.js';
import { AddressReceiptService } from './address-receipt.service.js';
import { HealthController } from './health.controller.js';
import { NotFoundController } from './not-found.controller.js';
import { StaticController } from './static.controller.js';

@Module({
  controllers: [HealthController, StaticController, AddressReceiptController, NotFoundController],
  providers: [AddressReceiptService],
})
export class InboundModule {}
