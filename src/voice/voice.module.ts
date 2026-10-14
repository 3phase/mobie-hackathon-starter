import { Module } from '@nestjs/common';
import { InboundModule } from '../inbound/inbound.module.js';
import { MapboxModule } from '../mapbox/mapbox.module.js';
import { CALL_SESSION_STORE } from './session/call-session-store.interface.js';
import { InMemoryCallSessionStore } from './session/in-memory-call-session.store.js';
import { AddressResolutionService } from './services/address-resolution.service.js';
import { VoiceOrchestrationService } from './services/voice-orchestration.service.js';
import { VoiceBookingController, VoiceController } from './voice.controller.js';

@Module({
  imports: [InboundModule, MapboxModule],
  controllers: [VoiceController, VoiceBookingController],
  providers: [
    InMemoryCallSessionStore,
    { provide: CALL_SESSION_STORE, useExisting: InMemoryCallSessionStore },
    AddressResolutionService,
    VoiceOrchestrationService,
  ],
  exports: [CALL_SESSION_STORE],
})
export class VoiceModule {}
