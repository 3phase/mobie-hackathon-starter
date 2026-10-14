import type { InjectionToken, Provider } from '@nestjs/common';

export type FetchFunction = typeof globalThis.fetch;
export type Clock = () => number;

export const FETCH = 'FETCH' as InjectionToken;
export const CLOCK = 'CLOCK' as InjectionToken;

export const runtimeProviders: Provider[] = [
  { provide: FETCH, useValue: globalThis.fetch.bind(globalThis) },
  { provide: CLOCK, useValue: Date.now },
];
