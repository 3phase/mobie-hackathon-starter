import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/configuration.js';

const validEnvironment = {
  AUTH0_DOMAIN: 'tenant.example.com',
  AUTH0_CLIENT_ID: 'public-client',
  AUTH0_AUDIENCE: 'https://api-staging.example',
  STARTER_API_KEY: 'test-key-with-at-least-32-characters',
};

test('configuration applies safe local and staging defaults', () => {
  assert.deepEqual(loadConfig(validEnvironment), {
    issuer: 'https://tenant.example.com',
    clientId: 'public-client',
    audience: 'https://api-staging.example',
    redirectUri: 'http://localhost:3000/callback',
    baseUrl: 'https://api-staging.mobie.at',
    apiKey: 'test-key-with-at-least-32-characters',
    mapboxToken: '',
    port: 3000,
    host: '127.0.0.1',
  });
});

test('configuration rejects placeholders, unsafe callbacks and the production mobie origin', () => {
  assert.throws(() => loadConfig({ ...validEnvironment, AUTH0_DOMAIN: 'YOUR_TENANT' }), /AUTH0_DOMAIN/);
  assert.throws(
    () => loadConfig({ ...validEnvironment, AUTH0_REDIRECT_URI: 'http://example.com/callback' }),
    /AUTH0_REDIRECT_URI/,
  );
  assert.throws(() => loadConfig({ ...validEnvironment, MOBIE_API_URL: 'https://api.mobie.at' }), /production/);
  assert.throws(() => loadConfig({ ...validEnvironment, STARTER_API_KEY: 'short' }), /32/);
});
