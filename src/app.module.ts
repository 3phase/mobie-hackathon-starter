import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { ApiKeyGuard } from './common/guards/api-key.guard.js';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware.js';
import { InboundModule } from './inbound/inbound.module.js';
import { MapboxModule } from './mapbox/mapbox.module.js';
import { MobieModule } from './mobie/mobie.module.js';
import { StringProcessingModule } from './string-processing/string-processing.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    CommonModule,
    AuthModule,
    MapboxModule,
    MobieModule,
    StringProcessingModule,
    InboundModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*path');
  }
}
