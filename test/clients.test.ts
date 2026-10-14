import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/auth/auth.service.js';
import { UpstreamHttpClient } from '../src/common/http/upstream-http.client.js';
import type { FetchFunction } from '../src/common/providers/runtime.providers.js';
import type { AppConfig } from '../src/config/config.types.js';
import { MapboxClient } from '../src/mapbox/mapbox.client.js';
import { MapboxService } from '../src/mapbox/mapbox.service.js';
import { MobieClient } from '../src/mobie/mobie.client.js';
import { MobieService } from '../src/mobie/mobie.service.js';

const baseConfig: AppConfig = {
  issuer: 'https://tenant.example', clientId: 'client', audience: 'audience', redirectUri: 'http://localhost:3000/callback',
  baseUrl: 'https://staging.example', apiKey: 'test-key-with-at-least-32-characters', mapboxToken: '', port: 3000, host: '127.0.0.1',
};
const ride = {
  departure: { publicName: 'Start', latitude: 48.2, longitude: 16.3 },
  destination: { publicName: 'End', latitude: 48.3, longitude: 16.4 },
  time: '2026-10-20T09:00:00+02:00', seatsRequested: 1,
};

async function authenticatedClient(fetch: FetchFunction): Promise<MobieClient> {
  const http = new UpstreamHttpClient(fetch);
  const auth = new AuthService(baseConfig, Date.now, http);
  const { state } = auth.beginLogin();
  await auth.finishLogin({ code: 'code', state, cookieState: state });
  return new MobieClient(baseConfig, auth, http);
}

test('REST search sends coordinates with a user access token and returns the raw suggestion array', async () => {
  const fetch: FetchFunction = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      return Response.json({ access_token: 'user-access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600 });
    }
    assert.equal(url, 'https://staging.example/rides/search');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer user-access');
    assert.deepEqual(JSON.parse(init?.body as string), ride);
    return Response.json([{ ride: { id: 'ride-1' }, estimatedPrice: 0 }]);
  };
  const client = await authenticatedClient(fetch);
  const service = new MobieService(client);
  assert.deepEqual(await service.searchRides(ride), [{ ride: { id: 'ride-1' }, estimatedPrice: 0 }]);
});

test('invalid coordinates, timezones and seat counts fail before calling upstream', async () => {
  const client = await authenticatedClient(async (input) => {
    if (String(input).endsWith('/oauth/token')) {
      return Response.json({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600 });
    }
    return assert.fail('No mobie request expected');
  });
  const service = new MobieService(client);
  for (const payload of [
    { ...ride, departure: { latitude: '48.2', longitude: 16.3 } },
    { ...ride, destination: { latitude: 100, longitude: 16.3 } },
    { ...ride, seatsRequested: 0 },
    { ...ride, time: 'tomorrow' },
    { ...ride, time: '2026-10-20T09:00:00' },
  ]) {
    await assert.rejects(async () => service.searchRides(payload), (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 400));
  }
});

test('booking requires explicit confirmation and never automatically retries a failed write', async () => {
  let calls = 0;
  const client = await authenticatedClient(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      return Response.json({ access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 3600 });
    }
    calls += 1;
    assert.equal(url, 'https://staging.example/rides/ride-1/join-detailed');
    assert.deepEqual(JSON.parse(init?.body as string), ride);
    return Response.json({ message: 'Already requested' }, { status: 409 });
  });
  const service = new MobieService(client);
  await assert.rejects(async () => service.joinRide('ride-1', ride, false), /confirm/i);
  await assert.rejects(async () => service.joinRide('ride-1', ride, 'true'), /confirm/i);
  assert.equal(calls, 0);
  await assert.rejects(async () => service.joinRide('ride-1', ride, true), (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 409));
  assert.equal(calls, 1);
});

test('Mapbox results map longitude and latitude correctly without leaking provider IDs into mobie IDs', async () => {
  const config = { ...baseConfig, mapboxToken: 'mapbox-secret' };
  const fetch: FetchFunction = async (input) => {
    const parsed = new URL(String(input));
    assert.equal(parsed.pathname, '/search/geocode/v6/forward');
    assert.equal(parsed.searchParams.get('permanent'), 'true');
    assert.equal(parsed.searchParams.get('country'), 'AT');
    assert.equal(parsed.searchParams.get('q'), 'Wien Hauptstraße');
    return Response.json({
      features: [{ id: 'mapbox.fake', geometry: { coordinates: [16.3, 48.2] }, properties: { name: 'Hauptstraße', full_address: 'Hauptstraße, Wien', coordinates: { longitude: 16.3, latitude: 48.2 } } }],
      attribution: 'Mapbox',
    });
  };
  const service = new MapboxService(new MapboxClient(config, new UpstreamHttpClient(fetch)));
  assert.deepEqual(await service.searchLocations('Wien Hauptstraße'), {
    candidates: [{ publicName: 'Hauptstraße', addressLine: 'Hauptstraße, Wien', longitude: 16.3, latitude: 48.2 }],
    attribution: 'Mapbox',
  });
  await assert.rejects(async () => service.searchLocations(''), (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 400));
});
