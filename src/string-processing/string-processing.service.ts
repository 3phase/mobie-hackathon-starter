import { Injectable } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';
import type { ProcessedTripSearch, TripSearchStrings } from './string-processing.types.js';

const offsetDateTime = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function text(value: unknown, field: 'departure' | 'destination'): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string.`);
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 256) {
    throw new HttpError(400, `${field} must contain 1–256 characters.`);
  }
  return normalized;
}

function time(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'time must be an ISO-8601 datetime with Z or an explicit offset (e.g. +02:00).');
  }
  const normalized = value.trim();
  if (!offsetDateTime.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    throw new HttpError(400, 'time must be an ISO-8601 datetime with Z or an explicit offset (e.g. +02:00).');
  }
  return normalized;
}

function seats(value: unknown): number {
  const normalized = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (typeof normalized !== 'number' || !Number.isInteger(normalized) || normalized < 1 || normalized > 8) {
    throw new HttpError(400, 'seatsRequested must be an integer from 1 to 8.');
  }
  return normalized;
}

@Injectable()
export class StringProcessingService {
  public processTripSearch(input: TripSearchStrings): ProcessedTripSearch {
    return {
      departure: text(input.departure, 'departure'),
      destination: text(input.destination, 'destination'),
      time: time(input.time),
      seatsRequested: seats(input.seatsRequested ?? 1),
    };
  }
}
