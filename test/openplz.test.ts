import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FetchFunction } from '../src/common/providers/runtime.providers.js';
import type { AppConfig } from '../src/config/config.types.js';
import { PostcodeCacheService } from '../src/voice/cache/postcode-cache.service.js';
import { OpenPlzService } from '../src/voice/providers/openplz.service.js';
import type { LocalityEntry, StreetEntry } from '../src/voice/providers/openplz.types.js';
import { StreetMatchingService, textSimilarity } from '../src/voice/services/street-matching.service.js';
import { normalizeAustrianAddress } from '../src/voice/utils/austrian-address-normalizer.js';

const config: AppConfig = {
  issuer: 'https://tenant.example', clientId: 'client', audience: 'audience', redirectUri: 'http://localhost:3000/callback',
  baseUrl: 'https://staging.example', apiKey: 'test-key-with-at-least-32-characters', mapboxToken: '',
  openPlzBaseUrl: 'https://openplz.example', openPlzCacheTtlMs: 1_000, openPlzCacheMaxEntries: 2,
  openPlzTimeoutMs: 1_000, openPlzRetries: 0, port: 3000, host: '127.0.0.1',
};

const municipality = { key: '90001', code: '90001', name: 'Wien', status: 'Statutarstadt' };
const district = { key: '900', code: '903', name: 'Wien  3., Landstraße' };
const federalProvince = { key: '9', name: 'Wien' };
const locality: LocalityEntry = {
  key: '17225', name: 'Wien, Landstraße', postalCode: '1030', municipality, district, federalProvince,
};
const street = (key: string, name: string, localityName = locality.name): StreetEntry => ({
  key, name, locality: localityName, postalCode: '1030', municipality, district, federalProvince,
});

function pageResponse(items: unknown[], page: number, totalCount: number, pageSize = 50): Response {
  return Response.json(items, { headers: {
    'x-page': String(page), 'x-page-size': String(pageSize), 'x-total-count': String(totalCount),
    'x-total-pages': String(totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize)),
  } });
}

test('OpenPLZ pagination loads one page, every page, and an empty dataset', async () => {
  const all = Array.from({ length: 120 }, (_, index) => ({ index }));
  const calls: number[] = [];
  const fetch: FetchFunction = async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));
    calls.push(page);
    return pageResponse(all.slice((page - 1) * 50, page * 50), page, all.length);
  };
  const service = new OpenPlzService(config, fetch);
  assert.deepEqual(await service.fetchAllPages('/at/Streets', { postalCode: '1030' }), all);
  assert.deepEqual(calls.sort((a, b) => a - b), [1, 2, 3]);

  const single = new OpenPlzService(config, async () => pageResponse([{ id: 1 }], 1, 1));
  assert.deepEqual(await single.fetchAllPages('/at/Localities', { postalCode: '1030' }), [{ id: 1 }]);
  const empty = new OpenPlzService(config, async () => pageResponse([], 1, 0));
  assert.deepEqual(await empty.fetchAllPages('/at/Localities', { postalCode: '0000' }), []);
});

test('OpenPLZ rejects failed, malformed and inconsistent pages without returning partial data', async () => {
  const items = Array.from({ length: 101 }, (_, index) => ({ index }));
  const intermediateFailure = new OpenPlzService(config, async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));
    if (page === 2) return Response.json({ error: 'unavailable' }, { status: 503 });
    return pageResponse(items.slice((page - 1) * 50, page * 50), page, items.length);
  });
  await assert.rejects(() => intermediateFailure.fetchAllPages('/at/Streets', { postalCode: '1030' }), /HTTP 503/);

  const missingHeaders = new OpenPlzService(config, async () => Response.json([]));
  await assert.rejects(() => missingHeaders.fetchAllPages('/at/Localities', { postalCode: '1030' }), /x-page/i);

  const inconsistent = new OpenPlzService(config, async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));
    const response = pageResponse(items.slice((page - 1) * 50, page * 50), page, page === 1 ? 101 : 100);
    return response;
  });
  await assert.rejects(() => inconsistent.fetchAllPages('/at/Streets', { postalCode: '1030' }), /changed|inconsistent|incomplete/i);
});

test('OpenPLZ fetches no more than three remaining pages concurrently', async () => {
  const items = Array.from({ length: 350 }, (_, index) => ({ index }));
  let active = 0;
  let maximum = 0;
  const service = new OpenPlzService(config, async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));
    if (page > 1) {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    }
    return pageResponse(items.slice((page - 1) * 50, page * 50), page, items.length);
  });
  assert.equal((await service.fetchAllPages('/at/Streets', { postalCode: '1030' })).length, 350);
  assert.equal(maximum, 3);
});

test('OpenPLZ retries only a bounded number of transient failures', async () => {
  let calls = 0;
  const service = new OpenPlzService({ ...config, openPlzRetries: 1 }, async () => {
    calls += 1;
    return calls === 1 ? Response.json({}, { status: 503 }) : pageResponse([{ ok: true }], 1, 1);
  });
  assert.deepEqual(await service.fetchAllPages('/at/Localities', { postalCode: '1030' }), [{ ok: true }]);
  assert.equal(calls, 2);
});

test('OpenPLZ normalizes the documented Austrian response schema', async () => {
  const raw = { ...locality, municipality: { ...municipality }, district: { ...district }, federalProvince: { ...federalProvince } };
  const service = new OpenPlzService(config, async () => pageResponse([raw], 1, 1));
  assert.deepEqual(await service.fetchLocalities('1030'), [locality]);
});

test('postcode cache reuses, deduplicates, expires and evicts only complete loads', async () => {
  let now = 1_000;
  let localityCalls = 0;
  let streetCalls = 0;
  let fail = false;
  const provider = {
    async fetchLocalities(postcode: string) {
      localityCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (fail) throw new Error('failed');
      return [{ ...locality, postalCode: postcode }];
    },
    async fetchStreets(postcode: string) {
      streetCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (fail) throw new Error('failed');
      return [{ ...street('s1', 'Hauptstraße'), postalCode: postcode }];
    },
  } as unknown as OpenPlzService;
  const cache = new PostcodeCacheService(provider, { ...config, openPlzCacheMaxEntries: 1 }, () => now);
  const [first, concurrent] = await Promise.all([cache.get('1030'), cache.get('1030')]);
  assert.equal(first, concurrent);
  assert.equal(localityCalls, 1);
  assert.equal(streetCalls, 1);
  await cache.get('1030');
  assert.equal(localityCalls, 1);

  now += 1_001;
  await cache.get('1030');
  assert.equal(localityCalls, 2);
  await cache.get('4020');
  await cache.get('1030');
  assert.equal(localityCalls, 4, 'capacity-one cache evicts the least recently used postcode');

  fail = true;
  await assert.rejects(() => cache.get('9999'));
  fail = false;
  await cache.get('9999');
  assert.equal(localityCalls, 6, 'a failed load is retried instead of cached');
});

test('German normalization and fuzzy street ranking tolerate voice transcription variants', () => {
  assert.equal(normalizeAustrianAddress(' Landstraßer-Hauptstr. '), 'landstrasser hauptstrasse');
  assert.ok(textSimilarity('Müllnergasse', 'Muellnergasse') >= 0.97);
  const matcher = new StreetMatchingService();
  const ranked = matcher.rank('Landstrasser Hauptstrase', [
    street('later-page-best', 'Landstraßer Hauptstraße'),
    street('other', 'Ungargasse'),
  ]);
  assert.equal(ranked[0]?.street.key, 'later-page-best');
  assert.ok((ranked[0]?.score ?? 0) > 0.85);
  assert.deepEqual(matcher.rank('völlig anderer Begriff', [street('other', 'Ungargasse')]), []);
});
