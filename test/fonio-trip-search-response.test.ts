import test from 'node:test';
import assert from 'node:assert/strict';
import { fonioTripSearchResponse } from '../src/inbound/fonio-trip-search-response.js';

const request = {
  departure: 'Villagarten 4, 4221 Steyregg',
  destination: 'Bethlehemstraße, Linz',
  time: '2026-10-20T15:05:00+02:00',
  seatsRequested: 1,
};

test('Fonio response keeps caller metadata and omits rideDetails when no ride exists', () => {
  assert.deepEqual(fonioTripSearchResponse([], request), {
    status: 'no_ride_found',
    pickupAddress: request.departure,
    destinationAddress: request.destination,
    pickupTime: request.time,
    message: 'Ich habe derzeit keine passende Fahrt gefunden.',
  });
});

test('Fonio response falls back to the requested pickup time when Mobie has no estimate', () => {
  const response = fonioTripSearchResponse([{
    ride: { id: 'ride-example' },
    driver: { firstName: 'Alex' },
  }], request);

  assert.equal(response.pickupTime, request.time);
  assert.deepEqual(response.rideDetails, {
    rideId: 'ride-example',
    driverName: 'Alex',
    pickupTimeIsEstimated: false,
  });
});
