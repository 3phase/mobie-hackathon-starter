import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { FETCH, type FetchFunction } from '../src/common/providers/runtime.providers.js';
import { APP_CONFIG } from '../src/config/configuration.js';
import type { AppConfig } from '../src/config/config.types.js';

const key = 'test-key-with-at-least-32-characters';
const authorization = `Bearer ${key}`;
const payload = {
  departure: { latitude: 48.2, longitude: 16.3 }, destination: { latitude: 48.3, longitude: 16.4 },
  time: '2026-10-20T09:00:00+02:00', seatsRequested: 1,
};
const config: AppConfig = {
  apiKey: key, issuer: 'https://auth.example', clientId: 'client', audience: 'https://staging.example',
  redirectUri: 'http://localhost:3000/callback', baseUrl: 'https://staging.example', mapboxToken: 'mapbox-token',
  port: 3000, host: '127.0.0.1',
};

async function fixture(t: test.TestContext): Promise<{ app: INestApplication; writes: () => number }> {
  let writes = 0;
  const fetch: FetchFunction = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      return Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600, token_type: 'Bearer' });
    }
    if (url.includes('api.mapbox.com')) {
      return Response.json({ features: [{ geometry: { coordinates: [16.3, 48.2] }, properties: { name: 'Wien' } }], attribution: 'Mapbox' });
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-access');
    if (url.endsWith('/join-detailed')) {
      writes += 1;
      assert.equal((JSON.parse(init?.body as string) as Record<string, unknown>).confirmed, undefined);
      return Response.json({ rideRequest: { id: 'request-1', status: 'PENDING' }, suggestions: [] });
    }
    if (url.endsWith('/rides/search')) return Response.json([{ ride: { id: 'ride-1' } }]);
    return Response.json({ id: 'user-1' });
  };

  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG).useValue(config)
    .overrideProvider(FETCH).useValue(fetch)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApplication(app);
  await app.init();
  t.after(async () => app.close());
  return { app, writes: () => writes };
}

async function signIn(app: INestApplication): Promise<{ cookie: string; authorize: URL }> {
  const login = await request(app.getHttpServer()).post('/auth/login').set('Authorization', authorization).expect(200);
  const setCookie = login.headers['set-cookie'];
  assert.ok(setCookie);
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = cookieHeader?.split(';')[0];
  assert.ok(cookie);
  const authorize = new URL((login.body as { url: string }).url);
  await request(app.getHttpServer())
    .get(`/callback?code=test-code&state=${authorize.searchParams.get('state')}`)
    .set('Cookie', cookie)
    .redirects(0)
    .expect(303)
    .expect('Location', '/?login=success');
  return { cookie, authorize };
}

test('application bootstraps, serves public routes, protects API access and never returns OAuth tokens', async (t) => {
  const { app } = await fixture(t);
  await request(app.getHttpServer()).get('/').expect(200).expect('Content-Type', /html/);
  await request(app.getHttpServer()).get('/page.js').expect(200).expect('Content-Type', /javascript/);
  await request(app.getHttpServer()).get('/health').expect(200, { ok: true });
  await request(app.getHttpServer()).get('/api/me').expect(401, { error: 'Use the STARTER_API_KEY as a Bearer token for this server.' });
  await request(app.getHttpServer()).post('/auth/login').expect(401);
  const login = await request(app.getHttpServer()).post('/auth/login').set('Authorization', authorization).expect(200);
  const authorize = new URL((login.body as { url: string }).url);
  await request(app.getHttpServer()).get(`/callback?code=code&state=${authorize.searchParams.get('state')}`).redirects(0).expect(400);
  await signIn(app);
  const me = await request(app.getHttpServer()).get('/api/me').set('Authorization', authorization).expect(200);
  assert.deepEqual(me.body, { id: 'user-1' });
  for (const path of ['/', '/api/status']) {
    const response = await request(app.getHttpServer()).get(path).set('Authorization', authorization).expect(200);
    assert.doesNotMatch(response.text, /private-access|private-refresh/);
  }
  const protectedResponse = await request(app.getHttpServer()).get('/api/status').expect(401);
  assert.equal(protectedResponse.headers['cache-control'], 'no-store');
  assert.equal(protectedResponse.headers['x-content-type-options'], 'nosniff');
  assert.match(protectedResponse.headers['content-security-policy'] as string, /default-src 'none'/);
});

test('search-to-booking flow requires confirmation and preserves the PENDING response', async (t) => {
  const { app, writes } = await fixture(t);
  await signIn(app);
  const search = await request(app.getHttpServer()).post('/api/rides/search').set('Authorization', authorization).send(payload).expect(200);
  assert.deepEqual(search.body, [{ ride: { id: 'ride-1' } }]);
  await request(app.getHttpServer()).post('/api/rides/ride-1/join-detailed').set('Authorization', authorization).send(payload).expect(400);
  assert.equal(writes(), 0);
  const booked = await request(app.getHttpServer()).post('/api/rides/ride-1/join-detailed').set('Authorization', authorization).send({ ...payload, confirmed: true }).expect(200);
  assert.equal((booked.body as { rideRequest: { status: string } }).rideRequest.status, 'PENDING');
  assert.equal(writes(), 1);
});

test('validation, content type, body limit and provider errors preserve the error envelope', async (t) => {
  const { app } = await fixture(t);
  await signIn(app);
  await request(app.getHttpServer()).post('/api/rides/search').set('Authorization', authorization).set('Content-Type', 'application/json').send('{broken').expect(400, { error: 'Request body must be valid JSON.' });
  await request(app.getHttpServer()).post('/api/rides/search').set('Authorization', authorization).set('Content-Type', 'text/plain').send('{}').expect(415, { error: 'Use Content-Type: application/json.' });
  await request(app.getHttpServer()).post('/api/rides/search').set('Authorization', authorization).send({ ...payload, seatsRequested: 0 }).expect(400, { error: 'seatsRequested must be an integer from 1 to 8.' });
  await request(app.getHttpServer()).post('/api/locations/search').set('Authorization', authorization).send({ query: '' }).expect(400);
  const oversized = JSON.stringify({ query: 'a'.repeat(17_000) });
  await request(app.getHttpServer()).post('/api/locations/search').set('Authorization', authorization).set('Content-Type', 'application/json').send(oversized).expect(413, { error: 'JSON body is too large (maximum 16 KiB).' });
});

test('logging out removes access, status remains key-protected, and unlisted endpoints return 404', async (t) => {
  const { app } = await fixture(t);
  await signIn(app);
  await request(app.getHttpServer()).post('/api/logout').set('Authorization', authorization).expect(200, { authenticated: false });
  await request(app.getHttpServer()).get('/api/me').set('Authorization', authorization).expect(401, { error: 'Login required. Open the starter and sign in again.' });
  await request(app.getHttpServer()).get('/api/admin/users').set('Authorization', authorization).expect(404, { error: 'Endpoint not found. See docs/api.md.' });
});

test('address receipt works without upstream login and can be inspected only with the team key', async (t) => {
  const { app, writes } = await fixture(t);
  const query = 'Villagarten vier, Steyregg';
  await request(app.getHttpServer()).get('/api/addresses/received').expect(401);
  await request(app.getHttpServer()).post('/api/addresses/receive').send({ query }).expect(401);
  const response = await request(app.getHttpServer())
    .post('/api/addresses/receive')
    .set('Authorization', authorization)
    .send({ query })
    .expect(200);
  assert.equal(response.body.received, true);
  assert.equal(response.body.query, query);
  assert.ok(Number.isFinite(Date.parse(response.body.receivedAt)));
  const history = await request(app.getHttpServer())
    .get('/api/addresses/received')
    .set('Authorization', authorization)
    .expect(200);
  assert.deepEqual(history.body.receipts, [{ id: response.body.id, query, receivedAt: response.body.receivedAt }]);
  await request(app.getHttpServer())
    .post('/api/addresses/receive')
    .set('Authorization', authorization)
    .send({ query: ' ' })
    .expect(400);
  const afterInvalid = await request(app.getHttpServer())
    .get('/api/addresses/received')
    .set('Authorization', authorization)
    .expect(200);
  assert.equal(afterInvalid.body.receipts.length, 1);
  assert.equal(writes(), 0);
  const status = await request(app.getHttpServer())
    .get('/api/status')
    .set('Authorization', authorization)
    .expect(200);
  assert.equal(status.body.authenticated, false);
});

test('inbound trip strings flow through Mapbox and Mobie and the raw response is available to the frontend', async (t) => {
  const { app } = await fixture(t);
  await signIn(app);
  const trip = {
    departure: ' Villagarten   4, 4221 Steyregg ',
    destination: ' Bethlehemstraße, 4020 Linz ',
    time: '2026-10-19T15:00:00+02:00',
    seatsRequested: '1',
  };
  const search = await request(app.getHttpServer())
    .post('/api/trips/search')
    .set('Authorization', authorization)
    .send(trip)
    .expect(200);
  assert.deepEqual(search.body, [{ ride: { id: 'ride-1' } }]);

  const latest = await request(app.getHttpServer())
    .get('/api/trips/latest')
    .set('Authorization', authorization)
    .expect(200);
  assert.deepEqual(latest.body.result.response, search.body);
  assert.deepEqual(latest.body.result.request, {
    departure: 'Villagarten 4, 4221 Steyregg',
    destination: 'Bethlehemstraße, 4020 Linz',
    time: trip.time,
    seatsRequested: 1,
  });
  assert.equal(latest.body.result.resolved.departure.longitude, 16.3);
  assert.equal(latest.body.result.resolved.destination.latitude, 48.2);
});
