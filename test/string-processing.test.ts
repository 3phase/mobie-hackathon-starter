import test from 'node:test';
import assert from 'node:assert/strict';
import { StringProcessingService } from '../src/string-processing/string-processing.service.js';

const service = new StringProcessingService();

test('trip strings are normalized before provider calls', () => {
  assert.deepEqual(service.processTripSearch({
    departure: '  Villagarten   4, 4221 Steyregg ',
    destination: ' Bethlehemstraße 1, 4020 Linz ',
    time: ' 2026-10-19T15:00:00+02:00 ',
    seatsRequested: '2',
  }), {
    departure: 'Villagarten 4, 4221 Steyregg',
    destination: 'Bethlehemstraße 1, 4020 Linz',
    time: '2026-10-19T15:00:00+02:00',
    seatsRequested: 2,
  });
});

test('invalid trip strings fail before Mapbox or Mobie can be called', () => {
  for (const input of [
    { departure: '', destination: 'Linz', time: '2026-10-19T15:00:00+02:00' },
    { departure: 'Steyregg', destination: ' ', time: '2026-10-19T15:00:00+02:00' },
    { departure: 'Steyregg', destination: 'Linz', time: 'tomorrow' },
    { departure: 'Steyregg', destination: 'Linz', time: '2026-10-19T15:00:00+02:00', seatsRequested: 'nine' },
  ]) {
    assert.throws(() => service.processTripSearch(input), (error: unknown) =>
      Boolean(error && typeof error === 'object' && 'status' in error && error.status === 400));
  }
});
