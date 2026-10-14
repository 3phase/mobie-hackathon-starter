import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { NotFoundController } from './not-found.controller.js';
import { StaticController } from './static.controller.js';

@Module({ controllers: [HealthController, StaticController, NotFoundController] })
export class InboundModule {}
