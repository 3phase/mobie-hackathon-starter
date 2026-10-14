import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { MapboxService } from '../src/mapbox/mapbox.service.js';
import type { PostcodeCacheService } from '../src/voice/cache/postcode-cache.service.js';
import type { OpenPlzService } from '../src/voice/providers/openplz.service.js';
import type { LocalityEntry, PostcodeData, StreetEntry } from '../src/voice/providers/openplz.types.js';
import { AddressResolutionService } from '../src/voice/services/address-resolution.service.js';
import { StreetMatchingService } from '../src/voice/services/street-matching.service.js';

const province = { key: '9', name: 'Wien' };
const district = { key: '900', code: '903', name: 'Wien 3.' };
const wien = { key: '90001', code: '90001', name: 'Wien', status: 'Statutarstadt' };
const other = { key: '99999', code: '99999', name: 'Beispielstadt', status: 'Stadt' };

function locality(key: string, name: string, municipality = wien): LocalityEntry {
  return { key, name, postalCode: '1030', municipality, district, federalProvince: province };
}

function street(key: string, name: string, municipality = wien): StreetEntry {
  return { key, name, postalCode: '1030', locality: 'Wien, Landstraße', municipality, district, federalProvince: province };
}

function service(data: () => PostcodeData, mapboxCandidates: unknown[] = []) {
  let mapboxCalls = 0;
  const cache = { get: async () => data() } as unknown as PostcodeCacheService;
  const openPlz = {
    searchLocalities: async () => data().localities,
    searchStreets: async () => data().streets,
  } as unknown as OpenPlzService;
  const mapbox = {
    geocodeAddress: async () => {
      mapboxCalls += 1;
      return { candidates: mapboxCandidates, attribution: 'Mapbox' };
    },
  } as unknown as MapboxService;
  return {
    resolution: new AddressResolutionService(cache, openPlz, new StreetMatchingService(), mapbox),
    mapboxCalls: () => mapboxCalls,
  };
}

test('postcode inference groups multiple localities by municipality and preserves genuine municipality ambiguity', async () => {
  let data: PostcodeData = {
    postcode: '1030', fetchedAt: 1,
    localities: [locality('l1', 'Wien, Landstraße'), locality('l2', 'Wien, Erdberg')],
    streets: [],
  };
  const fixture = service(() => data);
  const oneMunicipality = await fixture.resolution.searchPostcode('1030');
  assert.equal(oneMunicipality.length, 1);
  assert.equal(oneMunicipality[0]?.city, 'Wien');
  assert.equal(oneMunicipality[0]?.municipalityKey, '90001');

  data = { ...data, localities: [...data.localities, locality('l3', 'Beispielort', other)] };
  const ambiguous = await fixture.resolution.searchPostcode('1030');
  assert.deepEqual(ambiguous.map((candidate) => candidate.city).sort(), ['Beispielstadt', 'Wien']);
});

test('city resolution distinguishes municipality from locality and supports Vienna aliasing', async () => {
  const data: PostcodeData = {
    postcode: '1030', fetchedAt: 1,
    localities: [locality('l1', 'Wien, Landstraße'), locality('l2', 'Wien, Erdberg')], streets: [],
  };
  const fixture = service(() => data);
  const candidates = await fixture.resolution.searchCity('Vienna', '1030');
  assert.equal(candidates[0]?.city, 'Wien');
  assert.equal(candidates[0]?.locality, undefined);
  const localities = await fixture.resolution.searchCity('Wien Landstrasse', '1030');
  assert.equal(localities[0]?.locality, 'Wien, Landstraße');
});

test('street resolution filters by postcode and municipality, keeps distinct shared names and does not call Mapbox', async () => {
  const data: PostcodeData = {
    postcode: '1030', fetchedAt: 1, localities: [locality('l1', 'Wien, Landstraße')],
    streets: [
      street('s1', 'Landstraßer Hauptstraße'),
      street('s2', 'Landstraßer Hauptstraße'),
      street('s3', 'Landstraßer Hauptstraße', other),
    ],
  };
  const fixture = service(() => data);
  const candidates = await fixture.resolution.searchAddress({
    postcode: '1030', city: 'Wien', municipalityKey: '90001', street: 'Landstrasser Hauptstrase',
    houseNumber: '12', status: 'COLLECTING', candidates: [],
  });
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0]?.id, candidates[1]?.id);
  assert.equal(fixture.mapboxCalls(), 0);

  const missing = await fixture.resolution.searchAddress({
    postcode: '1030', city: 'Wien', municipalityKey: '90001', street: 'Ganz anderer Name',
    houseNumber: '12', status: 'COLLECTING', candidates: [],
  });
  assert.deepEqual(missing, []);
});

test('street resolution supports city-first lookup when postcode is unknown', async () => {
  const data: PostcodeData = {
    postcode: '1030', fetchedAt: 1, localities: [locality('l1', 'Wien, Landstraße')],
    streets: [street('s1', 'Landstraßer Hauptstraße')],
  };
  const fixture = service(() => data);
  const candidates = await fixture.resolution.searchAddress({
    city: 'Wien', street: 'Landstrasser Hauptstrase', houseNumber: '12', status: 'COLLECTING', candidates: [],
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.postcode, '1030');
  assert.equal(candidates[0]?.city, 'Wien');
  assert.equal(fixture.mapboxCalls(), 0);
});

test('final geocoding accepts only address-level results consistent with street, postcode and house number', async () => {
  const selected = {
    id: 'street', displayName: 'Landstraßer Hauptstraße, 1030 Wien', kind: 'ADDRESS' as const,
    street: 'Landstraßer Hauptstraße', streetKey: 's1', postcode: '1030', city: 'Wien', municipalityKey: '90001',
  };
  const valid = {
    publicName: 'Landstraßer Hauptstraße 12', addressLine: 'Landstraßer Hauptstraße 12, 1030 Wien',
    longitude: 16.39, latitude: 48.2, externalId: 'address.1', featureType: 'address',
    postcode: '1030', city: 'Wien', street: 'Landstraßer Hauptstraße', houseNumber: '12',
    matchCode: { address_number: 'exact', street: 'exact', postcode: 'exact' },
  };
  const fixture = service(() => ({ postcode: '1030', fetchedAt: 1, localities: [], streets: [] }), [
    { ...valid, featureType: 'street' },
    { ...valid, postcode: '1040' },
    { ...valid, houseNumber: '14' },
    valid,
  ]);
  const results = await fixture.resolution.geocodeAddress({
    postcode: '1030', city: 'Wien', street: 'Landstraßer Hauptstraße', houseNumber: '12',
    status: 'NEEDS_CONFIRMATION', candidates: [selected],
  }, selected);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.latitude, 48.2);
  assert.equal(fixture.mapboxCalls(), 1);
});

test('final geocoding ignores a duplicated house number at the end of the candidate street', async () => {
  const selected = {
    id: 'street', displayName: 'Rainerstraße, 4020 Linz', kind: 'ADDRESS' as const,
    street: 'Rainerstraße', streetKey: 's1', postcode: '4020', city: 'Linz', municipalityKey: '40101',
  };
  const fixture = service(() => ({ postcode: '4020', fetchedAt: 1, localities: [], streets: [] }), [{
    publicName: 'Rainerstraße 1', addressLine: 'Rainerstraße 1, 4020 Linz',
    longitude: 14.29, latitude: 48.3, externalId: 'address.1', featureType: 'address',
    postcode: '4020', city: 'Linz', street: 'Rainerstraße 1',
    matchCode: { address_number: 'exact', street: 'exact', postcode: 'exact' },
  }]);

  const results = await fixture.resolution.geocodeAddress({
    postcode: '4020', city: 'Linz', street: 'Rainerstraße', houseNumber: '1',
    status: 'NEEDS_CONFIRMATION', candidates: [selected],
  }, selected);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.addressLine, 'Rainerstraße 1, 4020 Linz');
});
