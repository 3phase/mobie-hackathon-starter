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
const rideSearchResponse = [{
  ride: { id: 'ride-1', time: '2026-10-15T16:00:00Z' },
  driver: { id: 'driver-1', firstName: 'Alex', lastName: 'Beispiel' },
  pickupEta: '2026-10-15T16:05:00Z',
}];
const config: AppConfig = {
  apiKey: key, issuer: 'https://auth.example', clientId: 'client', audience: 'https://staging.example',
  redirectUri: 'http://localhost:3000/callback', baseUrl: 'https://staging.example', mapboxToken: 'mapbox-token',
  openPlzBaseUrl: 'https://openplzapi.org', openPlzCacheTtlMs: 86_400_000,
  openPlzCacheMaxEntries: 100, openPlzTimeoutMs: 8_000, openPlzRetries: 0,
  port: 3000, host: '127.0.0.1',
};

const openPlzMunicipalities = {
  '1030': { key: '90001', code: '90001', name: 'Wien', status: 'Statutarstadt' },
  '4020': { key: '40101', code: '40101', name: 'Linz', status: 'Statutarstadt' },
} as const;

function openPlzResponse(url: URL): Response {
  const postcode = url.searchParams.get('postalCode') as keyof typeof openPlzMunicipalities;
  const name = url.searchParams.get('name') ?? '';
  if (!postcode) {
    const steyr = { key: '40201', code: '40201', name: 'Steyr', status: 'Statutarstadt' };
    const steyregg = { key: '41624', code: '41624', name: 'Steyregg', status: 'Stadtgemeinde' };
    const linz = openPlzMunicipalities['4020'];
    const linzLand = { key: '41099', code: '41099', name: 'Linz-Land', status: 'Gemeinde' };
    const province = { key: '4', name: 'Oberösterreich' };
    const district = { key: '401', code: '401', name: 'Testbezirk' };
    let body: unknown[] = [];
    if (url.pathname.endsWith('/Localities') && /steyr/i.test(name)) {
      body = [
        { key: 'loc-steyr', name: 'Steyr', postalCode: '4400', municipality: steyr, district, federalProvince: province },
        { key: 'loc-steyregg', name: 'Steyr', postalCode: '4221', municipality: steyregg, district, federalProvince: province },
      ];
    } else if (url.pathname.endsWith('/Localities') && /linz/i.test(name)) {
      body = [
        { key: 'loc-linz', name: 'Linz', postalCode: '4020', municipality: linz, district, federalProvince: province },
        { key: 'loc-linz-land', name: 'Linz', postalCode: '4060', municipality: linzLand, district, federalProvince: province },
      ];
    } else if (url.pathname.endsWith('/Streets') && /stadtplatz/i.test(name)) {
      body = [
        { key: 'street-steyr-a', name: 'Stadtplatz', postalCode: '4400', locality: 'Steyr', municipality: steyr, district, federalProvince: province },
        { key: 'street-steyr-b', name: 'Stadtplatz', postalCode: '4407', locality: 'Steyr-Gleink', municipality: steyr, district, federalProvince: province },
      ];
    } else if (url.pathname.endsWith('/Streets') && /hauptplatz/i.test(name)) {
      body = [
        { key: 'street-linz-a', name: 'Hauptplatz', postalCode: '4020', locality: 'Linz', municipality: linz, district, federalProvince: province },
        { key: 'street-linz-b', name: 'Hauptplatz', postalCode: '4040', locality: 'Linz-Urfahr', municipality: linz, district, federalProvince: province },
      ];
    }
    return Response.json(body, { headers: {
      'x-page': '1', 'x-page-size': '50', 'x-total-count': String(body.length),
      'x-total-pages': body.length === 0 ? '0' : '1',
    } });
  }
  const municipality = openPlzMunicipalities[postcode];
  const localityName = postcode === '4020' ? 'Linz' : 'Wien, Landstraße';
  const base = {
    postalCode: postcode,
    municipality,
    district: { key: postcode === '4020' ? '401' : '900', code: postcode === '4020' ? '401' : '903', name: localityName },
    federalProvince: { key: postcode === '4020' ? '4' : '9', name: postcode === '4020' ? 'Oberösterreich' : 'Wien' },
  };
  const body = url.pathname.endsWith('/Localities')
    ? [{ ...base, key: `locality-${postcode}`, name: localityName }]
    : [{ ...base, key: `street-${postcode}`, name: postcode === '4020' ? 'Hauptplatz' : 'Landstraßer Hauptstraße', locality: localityName }];
  return Response.json(body, { headers: {
    'x-page': '1', 'x-page-size': '50', 'x-total-count': '1', 'x-total-pages': '1',
  } });
}

async function fixture(t: test.TestContext): Promise<{
  app: INestApplication;
  writes: () => number;
  joinedPayloads: () => Record<string, unknown>[];
  addressGeocodes: () => number;
}> {
  let writes = 0;
  let addressGeocodes = 0;
  const joinedPayloads: Record<string, unknown>[] = [];
  const fetch: FetchFunction = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth/token')) {
      return Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600, token_type: 'Bearer' });
    }
    if (url.startsWith('https://openplzapi.org/')) return openPlzResponse(new URL(url));
    if (url.includes('api.mapbox.com')) {
      const parsed = new URL(url);
      if (parsed.searchParams.has('address_number')) {
        addressGeocodes += 1;
        const street = parsed.searchParams.get('street')!;
        const postcode = parsed.searchParams.get('postcode')!;
        const houseNumber = parsed.searchParams.get('address_number')!;
        const city = parsed.searchParams.get('place')!;
        return Response.json({ features: [{
          id: `address.${postcode}.${houseNumber}`,
          geometry: { coordinates: postcode === '4020' ? [14.286, 48.306] : [16.39, 48.197] },
          properties: {
            feature_type: 'address', name: `${street} ${houseNumber}`,
            full_address: `${street} ${houseNumber}, ${postcode} ${city}`,
            context: {
              address: { address_number: houseNumber, street_name: street, name: `${street} ${houseNumber}` },
              street: { name: street },
              postcode: { name: postcode },
              place: { name: city },
            },
            match_code: { address_number: 'exact', street: 'exact', postcode: 'exact', place: 'exact' },
          },
        }], attribution: 'Mapbox' });
      }
      return Response.json({ features: [{ geometry: { coordinates: [16.3, 48.2] }, properties: { name: 'Wien' } }], attribution: 'Mapbox' });
    }
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-access');
    if (url.endsWith('/join-detailed')) {
      writes += 1;
      const joinedPayload = JSON.parse(init?.body as string) as Record<string, unknown>;
      assert.equal(joinedPayload.confirmed, undefined);
      joinedPayloads.push(joinedPayload);
      return Response.json({ rideRequest: { id: 'request-1', status: 'PENDING' }, suggestions: [] });
    }
    if (url.endsWith('/rides/search')) return Response.json(rideSearchResponse);
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
  return { app, writes: () => writes, joinedPayloads: () => joinedPayloads, addressGeocodes: () => addressGeocodes };
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
  assert.deepEqual(search.body, rideSearchResponse);
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

test('inbound trip strings flow through Mapbox and Mobie and return a Fonio response', async (t) => {
  const { app, writes, joinedPayloads } = await fixture(t);
  await signIn(app);
  const trip = {
    departure: ' Villagarten   4, 4221 Steyregg ',
    destination: ' Bethlehemstraße, 4020 Linz ',
    time: '2026-10-15T18:00:00',
    seatsRequested: '2',
  };
  const search = await request(app.getHttpServer())
    .post('/api/trips/search')
    .set('Authorization', authorization)
    .send(trip)
    .expect(200);
  assert.deepEqual(search.body, {
    status: 'ride_found',
    rideDetails: {
      rideId: 'ride-1',
      driverName: 'Alex',
      pickupTimeIsEstimated: true,
    },
    pickupAddress: 'Villagarten 4, 4221 Steyregg',
    destinationAddress: 'Bethlehemstraße, 4020 Linz',
    pickupTime: '2026-10-15T18:05:00+02:00',
    message: 'Ich habe eine passende Fahrt mit Alex gefunden. Abholung ist voraussichtlich am 15. Oktober um 18:05 Uhr am Villagarten 4, 4221 Steyregg. Dein Ziel ist Bethlehemstraße, 4020 Linz. Soll ich diese Fahrt für dich anfragen?',
  });

  const latest = await request(app.getHttpServer())
    .get('/api/trips/latest')
    .set('Authorization', authorization)
    .expect(200);
  assert.deepEqual(latest.body.result.response, search.body);
  assert.deepEqual(latest.body.result.mobieResponse, rideSearchResponse);
  assert.deepEqual(latest.body.result.request, {
    departure: 'Villagarten 4, 4221 Steyregg',
    destination: 'Bethlehemstraße, 4020 Linz',
    time: '2026-10-15T18:00:00+02:00',
    seatsRequested: 2,
  });
  assert.equal(latest.body.result.resolved.departure.longitude, 16.3);
  assert.equal(latest.body.result.resolved.destination.latitude, 48.2);

  const joined = await request(app.getHttpServer())
    .post('/api/trips/join')
    .set('Authorization', authorization)
    .send({ rideId: 'ride-1' })
    .expect(200);
  assert.equal(joined.body.rideRequest.status, 'PENDING');
  assert.equal(writes(), 1);
  assert.equal(joinedPayloads()[0]?.seatsRequested, 1);
});

test('trip join requires a string ID from a recent completed search', async (t) => {
  const { app, writes } = await fixture(t);
  await signIn(app);

  const missingId = await request(app.getHttpServer())
    .post('/api/trips/join')
    .set('Authorization', authorization)
    .send({});
  assert.deepEqual({ status: missingId.status, body: missingId.body }, {
    status: 400,
    body: { error: 'rideId must be a non-empty string.' },
  });
  await request(app.getHttpServer())
    .post('/api/trips/join')
    .set('Authorization', authorization)
    .send({ rideId: 123 })
    .expect(400, { error: 'rideId must be a non-empty string.' });
  await request(app.getHttpServer())
    .post('/api/trips/join')
    .set('Authorization', authorization)
    .send({ rideId: 'unknown-ride' })
    .expect(404, { error: 'Trip not found in recent searches. Search for the trip before joining it.' });
  assert.equal(writes(), 0);
});

test('legacy rideId booking remains compatible with a recent trip search and string consent', async (t) => {
  const { app, writes } = await fixture(t);
  await signIn(app);
  const server = app.getHttpServer();

  const search = await request(server)
    .post('/api/trips/search')
    .set('Authorization', authorization)
    .send({
      departure: 'Villagarten 4, 4221 Steyregg',
      destination: 'Bethlehemstraße, 4020 Linz',
      time: '2026-10-15T18:00:00+02:00',
      seatsRequested: 1,
    })
    .expect(200);

  const booking = await request(server)
    .post('/ride/join')
    .set('Authorization', authorization)
    .send({
      sessionId: 'https://app.fonio.ai/inbox?id=legacy-booking',
      rideId: search.body.rideDetails.rideId,
      confirmed: 'true',
      reply: 'Ja bitte',
    })
    .expect(200);

  assert.equal(booking.body.status, 'PENDING_BOOKING');
  assert.equal(booking.body.proposalToken, 'ride-1');
  assert.equal(booking.body.data.rideId, 'ride-1');
  assert.equal(writes(), 1);
});

test('voice routes collect independent addresses, reject stale choices, search rides and reuse booking', async (t) => {
  const { app, writes, addressGeocodes } = await fixture(t);
  await signIn(app);
  const server = app.getHttpServer();
  const headers = { Authorization: authorization };
  const sessionId = 'fonio-call-123';

  const originPostcode = await request(server)
    .post('/api/voice/postcodes/search').set(headers)
    .send({ sessionId, side: 'origin', postcode: ' 1030 ' }).expect(200);
  assert.equal(originPostcode.body.data.postcode, '1030');
  assert.equal(originPostcode.body.status, 'RESOLVED');
  assert.equal(originPostcode.body.data.city, 'Wien');

  const staleOriginAddress = await request(server)
    .post('/api/voice/addresses/search').set(headers)
    .send({ sessionId, side: 'origin', street: 'Landstraßer Hauptstraße', houseNumber: '12' }).expect(200);
  assert.equal(addressGeocodes(), 0, 'OpenPLZ discovery must not call Mapbox');
  await request(server)
    .post('/api/voice/postcodes/search').set(headers)
    .send({ sessionId, side: 'origin', postcode: '1030' }).expect(200);
  await request(server)
    .post('/api/voice/addresses/confirm').set(headers)
    .send({ sessionId, side: 'origin', candidateId: staleOriginAddress.body.candidates[0].id })
    .expect(200, {
      status: 'INVALID_CONTEXT', sessionId, side: 'origin',
      clarificationQuestion: 'That candidate is invalid or stale. Search again before selecting an option.',
    });
  const originAddress = await request(server)
    .post('/api/voice/addresses/search').set(headers)
    .send({ sessionId, side: 'origin', street: 'Landstraßer Hauptstraße', houseNumber: '12' }).expect(200);
  await request(server)
    .post('/api/voice/addresses/confirm').set(headers)
    .send({ sessionId, side: 'origin', candidateId: originAddress.body.candidates[0].id }).expect(200);
  assert.equal(addressGeocodes(), 1);
  const repeatedOriginConfirmation = await request(server)
    .post('/api/voice/addresses/confirm').set(headers)
    .send({
      sessionId,
      from: { postcode: '1030', city: 'Wien', street: 'Landstraßer Hauptstraße', houseNumber: '12' },
      candidateToken: originAddress.body.candidates[0].id,
      confirmed: true,
      reply: 'Option A',
    }).expect(200);
  assert.equal(repeatedOriginConfirmation.body.status, 'RESOLVED');
  assert.equal(addressGeocodes(), 1, 'an idempotent confirmation must not geocode twice');

  const unresolved = await request(server)
    .post('/api/voice/rides/search').set(headers)
    .send({ sessionId, requestedTime: '2026-10-20T09:00:00+02:00' }).expect(200);
  assert.deepEqual(unresolved.body.data.unresolved, ['destination']);

  const destinationPostcode = await request(server)
    .post('/api/voice/postcodes/search').set(headers)
    .send({ sessionId, side: 'destination', postcode: '4020' }).expect(200);
  assert.equal(destinationPostcode.body.data.city, 'Linz');
  const destinationAddress = await request(server)
    .post('/api/voice/addresses/search').set(headers)
    .send({ sessionId, side: 'destination', street: 'Hauptplatz', houseNumber: '1' }).expect(200);
  assert.equal(addressGeocodes(), 1);
  await request(server)
    .post('/api/voice/addresses/confirm').set(headers)
    .send({ sessionId, side: 'destination', candidateId: destinationAddress.body.candidates[0].id }).expect(200);
  assert.equal(addressGeocodes(), 2);

  const ride = await request(server)
    .post('/api/voice/rides/search').set(headers)
    .send({ sessionId, requestedTime: '2026-10-20T09:00:00+02:00' }).expect(200);
  assert.equal(ride.body.status, 'RESOLVED');
  assert.equal(ride.body.data.rideDetails.rideId, 'ride-1');
  assert.equal(ride.body.proposalToken, 'ride-1');
  const booking = await request(server).post('/ride/join').set(headers)
    .send({ sessionId, proposalToken: ride.body.proposalToken, confirmed: true })
    .expect(200);
  assert.equal(booking.body.status, 'PENDING_BOOKING');
  assert.equal(writes(), 1);

  await request(server)
    .post('/api/voice/sessions/end').set(headers).send({ sessionId }).expect(200, {
      status: 'RESOLVED', sessionId, data: { deleted: true },
    });
  const expired = await request(server)
    .post('/api/voice/rides/search').set(headers)
    .send({ sessionId, requestedTime: '2026-10-20T09:00:00+02:00' }).expect(200);
  assert.equal(expired.body.status, 'INVALID_CONTEXT');
});

test('all 12 Fonio webhook request contracts work with city-first resolution and explicit consent', async (t) => {
  const { app, writes, joinedPayloads } = await fixture(t);
  await signIn(app);
  const server = app.getHttpServer();
  const headers = { Authorization: authorization };

  // 1. mobie_search_from_postcode
  const fromPostcode = await request(server).post('/api/voice/postcodes/search').set(headers).send({
    sessionId: 'fonio-postcode-contract',
    from: { postcode: '1030' },
  }).expect(200);
  assert.equal(fromPostcode.body.side, 'origin');
  assert.equal(fromPostcode.body.data.postcode, '1030');

  // 6. mobie_search_destination_postcode
  const destinationPostcode = await request(server).post('/api/voice/postcodes/search').set(headers).send({
    sessionId: 'fonio-postcode-contract',
    destination: { postcode: '4020' },
  }).expect(200);
  assert.equal(destinationPostcode.body.side, 'destination');
  assert.equal(destinationPostcode.body.data.postcode, '4020');

  const sessionId = 'fonio-12-contracts';

  // 2. mobie_search_from_city (blank postcode is intentionally unknown)
  const fromCity = await request(server).post('/api/voice/cities/search').set(headers).send({
    sessionId,
    from: { postcode: '', city: 'Steyr' },
  }).expect(200);
  assert.equal(fromCity.body.status, 'NEEDS_CLARIFICATION');
  assert.equal(fromCity.body.data.resolutionStatus, 'AMBIGUOUS');
  assert.equal(fromCity.body.candidates[0].candidateToken, fromCity.body.candidates[0].id);
  assert.equal(fromCity.body.candidates[0].optionLabel, 'option A');

  // 3. mobie_select_from_city: declining preserves the candidates; a later explicit choice applies it.
  const declinedCity = await request(server).post('/api/voice/cities/confirm').set(headers).send({
    sessionId,
    from: { postcode: '', city: 'Steyr' },
    candidateToken: 'option A',
    confirmed: 'false',
    reply: 'Nein, noch nicht',
  }).expect(200);
  assert.equal(declinedCity.body.status, 'DECLINED');
  const selectedFromCity = await request(server).post('/api/voice/cities/confirm').set(headers).send({
    sessionId,
    from: { postcode: '', city: 'Steyr' },
    candidateToken: 'option A',
    confirmed: 'true',
    reply: 'Option A',
  }).expect(200);
  assert.equal(selectedFromCity.body.data.city, 'Steyr');
  assert.equal(selectedFromCity.body.data.postcode, undefined);

  // 4. mobie_search_from_address: OpenPLZ derives canonical postcode candidates from the city.
  const fromAddress = await request(server).post('/api/voice/addresses/search').set(headers).send({
    sessionId,
    from: { postcode: '', city: 'Steyr', street: 'Stadtplatz', houseNumber: '1' },
  }).expect(200);
  assert.equal(fromAddress.body.data.resolutionStatus, 'AMBIGUOUS');
  assert.equal(fromAddress.body.candidates.length, 2);

  // 5. mobie_select_from_address
  const selectedFromAddress = await request(server).post('/api/voice/addresses/confirm').set(headers).send({
    sessionId,
    from: { postcode: '', city: 'Steyr', street: 'Stadtplatz', houseNumber: '1' },
    candidateToken: 'option A',
    confirmed: true,
    reply: 'Option A',
  }).expect(200);
  assert.equal(selectedFromAddress.body.status, 'RESOLVED');
  assert.equal(selectedFromAddress.body.data.postcode, '4400');
  const staleFromOption = await request(server).post('/api/voice/addresses/confirm').set(headers).send({
    sessionId,
    from: { postcode: '', city: 'Steyr', street: 'Stadtplatz', houseNumber: '1' },
    candidateToken: 'option A',
    confirmed: true,
    reply: 'Option A',
  }).expect(200);
  assert.equal(staleFromOption.body.status, 'INVALID_CONTEXT');

  // 7. mobie_search_destination_city
  const destinationCity = await request(server).post('/api/voice/cities/search').set(headers).send({
    sessionId,
    destination: { postcode: '', city: 'Linz' },
  }).expect(200);
  assert.equal(destinationCity.body.data.resolutionStatus, 'AMBIGUOUS');

  // 8. mobie_select_destination_city (actual candidate token, not a label)
  const selectedDestinationCity = await request(server).post('/api/voice/cities/confirm').set(headers).send({
    sessionId,
    destination: { postcode: '', city: 'Linz' },
    candidateToken: destinationCity.body.candidates[0].candidateToken,
    confirmed: true,
    reply: 'Option A',
  }).expect(200);
  assert.equal(selectedDestinationCity.body.data.city, 'Linz');

  // 9. mobie_search_destination_address
  const destinationAddress = await request(server).post('/api/voice/addresses/search').set(headers).send({
    sessionId,
    destination: { postcode: '', city: 'Linz', street: 'Hauptplatz', houseNumber: '1' },
  }).expect(200);
  assert.equal(destinationAddress.body.data.resolutionStatus, 'AMBIGUOUS');

  // 10. mobie_select_destination_address
  const selectedDestinationAddress = await request(server).post('/api/voice/addresses/confirm').set(headers).send({
    sessionId,
    destination: { postcode: '', city: 'Linz', street: 'Hauptplatz', houseNumber: '1' },
    candidateToken: 'option A',
    confirmed: true,
    reply: 'Option A',
  }).expect(200);
  assert.equal(selectedDestinationAddress.body.status, 'RESOLVED');
  assert.equal(selectedDestinationAddress.body.data.postcode, '4020');

  const fullFrom = {
    postcode: '4400', city: 'Steyr', street: 'Stadtplatz', houseNumber: '1',
    publicName: 'stale Fonio origin', addressLine: 'stale Fonio origin', longitude: 1, latitude: 1,
  };
  const fullDestination = {
    postcode: '4020', city: 'Linz', street: 'Hauptplatz', houseNumber: '1',
    publicName: 'stale Fonio destination', addressLine: 'stale Fonio destination', longitude: 2, latitude: 2,
  };

  // 11. mobie_search_ride
  const ride = await request(server).post('/api/voice/rides/search').set(headers).send({
    sessionId,
    from: fullFrom,
    destination: fullDestination,
    time: '2026-10-20T09:00:00+02:00',
    seatsRequested: 2,
  }).expect(200);
  assert.equal(ride.body.status, 'RESOLVED');
  assert.equal(ride.body.proposalToken, 'ride-1');
  assert.equal(ride.body.data.proposalToken, 'ride-1');

  // 12. mobie_confirm_booking: false never writes; true returns a pending booking.
  const bookingBody = {
    sessionId,
    from: fullFrom,
    destination: fullDestination,
    time: '2026-10-20T09:00:00+02:00',
    seatsRequested: 2,
    proposalToken: ride.body.proposalToken,
    confirmed: 'false',
    reply: 'Nein',
  };
  const declinedBooking = await request(server).post('/ride/join').set(headers).send(bookingBody).expect(200);
  assert.equal(declinedBooking.body.status, 'DECLINED');
  assert.equal(writes(), 0);

  await request(server).post('/ride/join').set(headers).send({
    ...bookingBody,
    confirmed: 'yes',
  }).expect(400, { error: 'confirmed must be true or false.' });
  assert.equal(writes(), 0);

  const booked = await request(server).post('/ride/join').set(headers).send({
    ...bookingBody,
    confirmed: 'true',
    reply: 'Ja, bitte buchen',
  }).expect(200);
  assert.equal(booked.body.status, 'PENDING_BOOKING');
  assert.equal(booked.body.data.booking.rideRequest.status, 'PENDING');
  assert.equal(writes(), 1);
  assert.equal((joinedPayloads()[0]?.departure as { longitude: number }).longitude, 16.39);
  assert.equal((joinedPayloads()[0]?.destination as { longitude: number }).longitude, 14.286);

  await request(server).post('/api/voice/addresses/search').set(headers).send({
    sessionId,
    from: { postcode: '4400', city: 'Steyr', street: 'Stadtplatz', houseNumber: '2' },
  }).expect(200);
  const staleBooking = await request(server).post('/ride/join').set(headers).send({
    ...bookingBody,
    confirmed: true,
    reply: 'Ja',
  }).expect(200);
  assert.equal(staleBooking.body.status, 'INVALID_CONTEXT');
  assert.equal(writes(), 1);
});
