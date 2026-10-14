import { InjectionToken } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig, Environment } from './config.types.js';

export const APP_CONFIG = 'APP_CONFIG' as InjectionToken;

export function loadConfig(env: Environment = process.env): AppConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value || value.includes('YOUR_')) {
      throw new Error(`Set ${name} in .env (see .env.example).`);
    }
    return value;
  };

  const domain = required('AUTH0_DOMAIN');
  if (!/^[a-zA-Z0-9.-]+$/.test(domain) || !domain.includes('.')) {
    throw new Error('AUTH0_DOMAIN must be a hostname without protocol or path.');
  }

  const redirect = new URL(env.AUTH0_REDIRECT_URI || 'http://localhost:3000/callback');
  if (
    redirect.pathname !== '/callback' ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password ||
    (redirect.protocol !== 'https:' &&
      !(redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname)))
  ) {
    throw new Error('AUTH0_REDIRECT_URI must end in /callback and use HTTPS (or HTTP on localhost).');
  }

  const base = new URL(env.MOBIE_API_URL || 'https://api-staging.mobie.at');
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    base.hostname === 'api.mobie.at'
  ) {
    throw new Error('MOBIE_API_URL must be an HTTPS staging origin, not the production API.');
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }

  const apiKey = required('STARTER_API_KEY');
  if (apiKey.length < 32) {
    throw new Error('STARTER_API_KEY must have at least 32 characters. Generate one with npm run setup.');
  }
  const positiveInteger = (name: string, fallback: number, minimum = 1): number => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < minimum) {
      throw new Error(`${name} must be an integer of at least ${minimum}.`);
    }
    return value;
  };

  const openPlzBase = new URL(env.OPENPLZ_BASE_URL || 'https://openplzapi.org');
  if (openPlzBase.protocol !== 'https:' || openPlzBase.username || openPlzBase.password || openPlzBase.search || openPlzBase.hash) {
    throw new Error('OPENPLZ_BASE_URL must be an HTTPS origin or base path without credentials, query or fragment.');
  }

  return {
    issuer: `https://${domain}`,
    clientId: required('AUTH0_CLIENT_ID'),
    audience: required('AUTH0_AUDIENCE'),
    redirectUri: redirect.toString(),
    baseUrl: base.origin,
    apiKey,
    mapboxToken: env.MAPBOX_ACCESS_TOKEN?.trim() || '',
    openPlzBaseUrl: openPlzBase.toString().replace(/\/$/, ''),
    openPlzCacheTtlMs: positiveInteger('OPENPLZ_CACHE_TTL_MS', 24 * 60 * 60 * 1_000),
    openPlzCacheMaxEntries: positiveInteger('OPENPLZ_CACHE_MAX_ENTRIES', 100),
    openPlzTimeoutMs: positiveInteger('OPENPLZ_TIMEOUT_MS', 8_000),
    openPlzRetries: positiveInteger('OPENPLZ_RETRIES', 2, 0),
    port,
    host: env.HOST || '127.0.0.1',
  };
}

export const appConfigProvider = {
  provide: APP_CONFIG,
  inject: [ConfigService],
  useFactory: (config: ConfigService): AppConfig =>
    loadConfig({
      MOBIE_API_URL: config.get<string>('MOBIE_API_URL'),
      AUTH0_DOMAIN: config.get<string>('AUTH0_DOMAIN'),
      AUTH0_CLIENT_ID: config.get<string>('AUTH0_CLIENT_ID'),
      AUTH0_AUDIENCE: config.get<string>('AUTH0_AUDIENCE'),
      AUTH0_REDIRECT_URI: config.get<string>('AUTH0_REDIRECT_URI'),
      STARTER_API_KEY: config.get<string>('STARTER_API_KEY'),
      MAPBOX_ACCESS_TOKEN: config.get<string>('MAPBOX_ACCESS_TOKEN'),
      OPENPLZ_BASE_URL: config.get<string>('OPENPLZ_BASE_URL'),
      OPENPLZ_CACHE_TTL_MS: config.get<string>('OPENPLZ_CACHE_TTL_MS'),
      OPENPLZ_CACHE_MAX_ENTRIES: config.get<string>('OPENPLZ_CACHE_MAX_ENTRIES'),
      OPENPLZ_TIMEOUT_MS: config.get<string>('OPENPLZ_TIMEOUT_MS'),
      OPENPLZ_RETRIES: config.get<string>('OPENPLZ_RETRIES'),
      PORT: config.get<string>('PORT'),
      HOST: config.get<string>('HOST'),
    }),
};
