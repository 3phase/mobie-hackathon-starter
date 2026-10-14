import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.js';
import { createAuth } from '../src/auth.js';
import { createMobieClient } from '../src/mobie.js';
import { createMapboxClient } from '../src/mapbox.js';

const key = 'test-key-with-at-least-32-characters';
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const payload = { departure: { latitude: 48.2, longitude: 16.3 }, destination: { latitude: 48.3, longitude: 16.4 }, time: '2026-10-20T09:00:00+02:00', seatsRequested: 1 };

async function fixture(t) {
  let writes = 0;
  const config = { apiKey: key, issuer: 'https://auth.example', clientId: 'client', audience: 'https://staging.example', redirectUri: 'http://localhost:3000/callback' };
  const auth = createAuth(config, { fetch: async () => Response.json({ access_token: 'private-access', refresh_token: 'private-refresh', expires_in: 3600, token_type: 'Bearer' }) });
  const mobie = createMobieClient({ baseUrl: 'https://staging.example', getAccessToken: auth.getAccessToken, fetch: async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer private-access');
    if (url.endsWith('/join-detailed')) {
      writes++;
      assert.equal(JSON.parse(options.body).confirmed, undefined);
      return Response.json({ rideRequest: { id: 'request-1', status: 'PENDING' }, suggestions: [] });
    }
    if (url.endsWith('/rides/search')) return Response.json([{ ride: { id: 'ride-1' } }]);
    return Response.json({ id: 'user-1' });
  } });
  const server = createServer(config, { auth, mobie, mapbox: createMapboxClient({ token: '' }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}`, writes: () => writes };
}

async function signIn(url) {
  const login = await fetch(`${url}/auth/login`, { method: 'POST', headers });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const authorize = new URL((await login.json()).url);
  const callback = await fetch(`${url}/callback?code=test-code&state=${authorize.searchParams.get('state')}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(callback.status, 303);
  return { cookie, authorize };
}

test('HTTP login binds the browser cookie, protects API access and never returns OAuth tokens', async t => {
  const { url } = await fixture(t);
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/api/me`)).status, 401);
  assert.equal((await fetch(`${url}/auth/login`, { method: 'POST' })).status, 401);
  const login = await fetch(`${url}/auth/login`, { method: 'POST', headers });
  const authorize = new URL((await login.json()).url);
  const state = authorize.searchParams.get('state');
  assert.equal((await fetch(`${url}/callback?code=code&state=${state}`, { redirect: 'manual' })).status, 400);
  await signIn(url);
  const me = await fetch(`${url}/api/me`, { headers });
  assert.deepEqual(await me.json(), { id: 'user-1' });
  for (const path of ['/', '/api/status']) {
    const response = await fetch(`${url}${path}`, { headers });
    assert.doesNotMatch(await response.text(), /private-access|private-refresh/);
  }
});

test('search-to-booking HTTP flow requires confirmation and preserves PENDING response', async t => {
  const { url, writes } = await fixture(t);
  await signIn(url);
  const search = await fetch(`${url}/api/rides/search`, { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.deepEqual(await search.json(), [{ ride: { id: 'ride-1' } }]);
  const denied = await fetch(`${url}/api/rides/ride-1/join-detailed`, { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal(denied.status, 400);
  assert.equal(writes(), 0);
  const booked = await fetch(`${url}/api/rides/ride-1/join-detailed`, { method: 'POST', headers, body: JSON.stringify({ ...payload, confirmed: true }) });
  assert.equal(booked.status, 200);
  assert.equal((await booked.json()).rideRequest.status, 'PENDING');
  assert.equal(writes(), 1);
});

test('invalid JSON is rejected and logging out removes access for subsequent requests', async t => {
  const { url } = await fixture(t);
  await signIn(url);
  const bad = await fetch(`${url}/api/rides/search`, { method: 'POST', headers, body: '{broken' });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`${url}/api/logout`, { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(`${url}/api/me`, { headers })).status, 401);
  assert.equal((await fetch(`${url}/api/admin/users`, { headers })).status, 404);
});

test('address receipt works without upstream login and can be inspected only with the team key', async t => {
  const { url, writes } = await fixture(t);
  const query = 'Villagarten vier, Steyregg';
  assert.equal((await fetch(`${url}/api/addresses/received`)).status, 401);
  assert.equal((await fetch(`${url}/api/addresses/receive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })).status, 401);
  const response = await fetch(`${url}/api/addresses/receive`, { method: 'POST', headers, body: JSON.stringify({ query }) });
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.received, true);
  assert.equal(receipt.query, query);
  assert.ok(Number.isFinite(Date.parse(receipt.receivedAt)));
  const history = await (await fetch(`${url}/api/addresses/received`, { headers })).json();
  assert.deepEqual(history.receipts, [{ id: receipt.id, query, receivedAt: receipt.receivedAt }]);
  const invalid = await fetch(`${url}/api/addresses/receive`, { method: 'POST', headers, body: JSON.stringify({ query: ' ' }) });
  assert.equal(invalid.status, 400);
  assert.equal((await (await fetch(`${url}/api/addresses/received`, { headers })).json()).receipts.length, 1);
  assert.equal(writes(), 0);
  assert.equal((await fetch(`${url}/api/status`, { headers }).then(r => r.json())).authenticated, false);
});
