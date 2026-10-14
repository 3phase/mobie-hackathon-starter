import { Global, Module } from '@nestjs/common';
import { UpstreamHttpClient } from './http/upstream-http.client.js';
import { runtimeProviders } from './providers/runtime.providers.js';
import { appConfigProvider } from '../config/configuration.js';

@Global()
@Module({
  providers: [appConfigProvider, ...runtimeProviders, UpstreamHttpClient],
  exports: [appConfigProvider, ...runtimeProviders, UpstreamHttpClient],
})
export class CommonModule {}
