import { HttpError } from '../common/errors/http.error.js';
import type { MobieLocation, RidePayload } from './mobie.types.js';

function location(value: unknown, name: string): MobieLocation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${name} must be a location object.`);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.id === 'string' && input.id.trim()) return { id: input.id.trim() };
  if (
    typeof input.longitude !== 'number' ||
    !Number.isFinite(input.longitude) ||
    Math.abs(input.longitude) > 180 ||
    typeof input.latitude !== 'number' ||
    !Number.isFinite(input.latitude) ||
    Math.abs(input.latitude) > 90
  ) {
    throw new HttpError(400, `${name} needs numeric longitude (-180..180) and latitude (-90..90).`);
  }

  const result: { longitude: number; latitude: number; publicName?: string; addressLine?: string } = {
    longitude: input.longitude,
    latitude: input.latitude,
  };
  for (const key of ['publicName', 'addressLine'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].length > 500) {
        throw new HttpError(400, `${name}.${key} must be a string of at most 500 characters.`);
      }
      result[key] = input[key];
    }
  }
  return result;
}

export function ridePayload(value: unknown): RidePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'A ride request object is required.');
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.time !== 'string' ||
    !/T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.time) ||
    !Number.isFinite(Date.parse(input.time))
  ) {
    throw new HttpError(400, 'time must be an ISO-8601 datetime with Z or an explicit offset (e.g. +02:00).');
  }
  const seatsRequested = input.seatsRequested ?? 1;
  if (typeof seatsRequested !== 'number' || !Number.isInteger(seatsRequested) || seatsRequested < 1 || seatsRequested > 8) {
    throw new HttpError(400, 'seatsRequested must be an integer from 1 to 8.');
  }
  return {
    departure: location(input.departure, 'departure'),
    destination: location(input.destination, 'destination'),
    time: input.time,
    seatsRequested,
  };
}

export function ridePath(id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    throw new HttpError(400, 'Invalid ride ID. Use ride.id from a search result.');
  }
  return `/rides/${encodeURIComponent(id)}`;
}
