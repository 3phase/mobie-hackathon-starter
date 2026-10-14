import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MobieClient } from './mobie.client.js';
import { MobieController } from './mobie.controller.js';
import { MobieService } from './mobie.service.js';

@Module({
  imports: [AuthModule],
  controllers: [MobieController],
  providers: [MobieClient, MobieService],
  exports: [MobieService],
})
export class MobieModule {}
