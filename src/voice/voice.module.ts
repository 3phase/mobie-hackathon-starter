import { Module } from '@nestjs/common';
import { MapboxModule } from '../mapbox/mapbox.module.js';
import { MobieModule } from '../mobie/mobie.module.js';
import { AddressResolutionService } from './services/address-resolution.service.js';
import { VoiceOrchestrationService } from './services/voice-orchestration.service.js';
import { VoiceBookingController, VoiceController } from './voice.controller.js';
import { OpenPlzService } from './providers/openplz.service.js';
import { PostcodeCacheService } from './cache/postcode-cache.service.js';
import { StreetMatchingService } from './services/street-matching.service.js';
import { CALL_SESSION_STORE } from './session/call-session-store.interface.js';
import { InMemoryCallSessionStore } from './session/in-memory-call-session.store.js';

@Module({
  imports: [MapboxModule, MobieModule],
  controllers: [VoiceController, VoiceBookingController],
  providers: [
    InMemoryCallSessionStore,
    { provide: CALL_SESSION_STORE, useExisting: InMemoryCallSessionStore },
    AddressResolutionService,
    OpenPlzService,
    PostcodeCacheService,
    StreetMatchingService,
    VoiceOrchestrationService,
  ],
  exports: [CALL_SESSION_STORE],
})
export class VoiceModule {}
