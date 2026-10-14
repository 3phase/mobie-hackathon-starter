import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '../src/common/errors/http.error.js';
import { AddressSide, type AddressCandidate } from '../src/voice/session/call-session.types.js';
import { CALL_SESSION_TTL_MS, InMemoryCallSessionStore } from '../src/voice/session/in-memory-call-session.store.js';

function cityCandidate(id = 'city-1'): AddressCandidate {
  return {
    id,
    displayName: 'Wien, Österreich',
    latitude: 48.2082,
    longitude: 16.3738,
    kind: 'CITY',
    city: 'Wien',
    postcode: '1010',
  };
}

function addressCandidate(id = 'address-1'): AddressCandidate {
  return {
    id,
    displayName: 'Stephansplatz 1, 1010 Wien',
    latitude: 48.2082,
    longitude: 16.3738,
    kind: 'ADDRESS',
    city: 'Wien',
    postcode: '1010',
  };
}

test('call sessions are created automatically and keep origin and destination independent', () => {
  let now = 1_000;
  const store = new InMemoryCallSessionStore(() => now);
  const created = store.getOrCreate('call-1');
  assert.equal(created.callId, 'call-1');
  assert.equal(created.origin.status, 'COLLECTING');
  assert.equal(created.destination.status, 'COLLECTING');

  now += 1;
  store.updateAddress('call-1', AddressSide.ORIGIN, { postcode: '0100', city: ' Wien ' });
  assert.deepEqual(store.get('call-1')?.destination, { status: 'COLLECTING', candidates: [] });

  now += 1;
  store.updateAddress('call-1', AddressSide.DESTINATION, { city: 'Linz' });
  assert.equal(store.get('call-1')?.origin.postcode, '0100');
  assert.equal(store.get('call-1')?.origin.city, ' Wien ');
  assert.equal(store.get('call-1')?.destination.city, 'Linz');
});

test('partial updates preserve fields and invalidate confirmations and stale candidates', () => {
  const store = new InMemoryCallSessionStore(() => 1_000);
  let session = store.updateAddress('call-2', AddressSide.ORIGIN, {
    postcode: '1010', city: 'Wien', street: 'Stephansplatz', houseNumber: '1',
  });
  session = store.save({
    ...session,
    origin: { ...session.origin, status: 'NEEDS_CONFIRMATION', candidates: [addressCandidate()] },
  });
  session = store.confirmCandidate('call-2', AddressSide.ORIGIN, 'address-1');
  assert.equal(session.origin.status, 'CONFIRMED');
  assert.equal(session.origin.resolvedLocation?.longitude, 16.3738);

  session = store.updateAddress('call-2', AddressSide.ORIGIN, { houseNumber: '2' });
  assert.equal(session.origin.postcode, '1010');
  assert.equal(session.origin.city, 'Wien');
  assert.equal(session.origin.street, 'Stephansplatz');
  assert.equal(session.origin.houseNumber, '2');
  assert.equal(session.origin.status, 'COLLECTING');
  assert.equal(session.origin.resolvedLocation, undefined);
  assert.deepEqual(session.origin.candidates, []);
  assert.throws(
    () => store.confirmCandidate('call-2', AddressSide.ORIGIN, 'address-1'),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );
});

test('valid city and address candidates can be selected only in their current context', () => {
  const store = new InMemoryCallSessionStore(() => 1_000);
  let session = store.getOrCreate('call-3');
  session = store.save({
    ...session,
    origin: { ...session.origin, status: 'NEEDS_CONFIRMATION', candidates: [cityCandidate()] },
  });
  session = store.confirmCandidate('call-3', AddressSide.ORIGIN, 'city-1');
  assert.equal(session.origin.city, 'Wien');
  assert.equal(session.origin.status, 'COLLECTING');
  assert.equal(session.origin.resolvedLocation, undefined);

  session = store.save({
    ...session,
    origin: { ...session.origin, status: 'NEEDS_CONFIRMATION', candidates: [addressCandidate()] },
  });
  session = store.confirmCandidate('call-3', AddressSide.ORIGIN, 'address-1');
  assert.equal(session.origin.status, 'CONFIRMED');
  assert.equal(session.origin.resolvedLocation?.displayName, 'Stephansplatz 1, 1010 Wien');
  assert.throws(() => store.confirmCandidate('call-3', AddressSide.ORIGIN, 'missing'), /invalid|stale/i);
  assert.throws(() => store.confirmCandidate('unknown', AddressSide.ORIGIN, 'missing'), /missing|expired/i);
});

test('inactive sessions expire after 45 minutes and explicit deletion ends a session', () => {
  let now = 10_000;
  const store = new InMemoryCallSessionStore(() => now);
  store.getOrCreate('expiring');
  now += CALL_SESSION_TTL_MS - 1;
  assert.ok(store.get('expiring'));
  now += 1;
  assert.equal(store.get('expiring'), undefined);

  store.getOrCreate('ended');
  assert.equal(store.delete('ended'), true);
  assert.equal(store.get('ended'), undefined);
});

test('runExclusive serializes conflicting updates for one call without blocking another call', async () => {
  const store = new InMemoryCallSessionStore(() => 1_000);
  const events: string[] = [];
  let releaseFirst = (): void => undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = store.runExclusive('same', async () => {
    events.push('first-start');
    await firstGate;
    store.updateAddress('same', AddressSide.ORIGIN, { city: 'Wien' });
    events.push('first-end');
  });
  const second = store.runExclusive('same', () => {
    events.push('second');
    store.updateAddress('same', AddressSide.ORIGIN, { street: 'Hauptstraße' });
  });
  const independent = store.runExclusive('other', () => { events.push('other'); });
  await independent;
  assert.deepEqual(events, ['first-start', 'other']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first-start', 'other', 'first-end', 'second']);
  assert.equal(store.get('same')?.origin.city, 'Wien');
  assert.equal(store.get('same')?.origin.street, 'Hauptstraße');
});
