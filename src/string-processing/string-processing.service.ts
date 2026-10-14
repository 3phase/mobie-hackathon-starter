import { Injectable } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';
import type { ProcessedTripSearch, TripSearchStrings } from './string-processing.types.js';

const dateTime = '(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.\\d+)?)?';
const localDateTime = new RegExp(`^${dateTime}$`);
const offsetDateTime = new RegExp(`^${dateTime}(?:Z|[+-]\\d{2}:\\d{2})$`);
const viennaParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface DateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function partsAt(instant: number): DateTimeParts {
  const parts = Object.fromEntries(
    viennaParts.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  } as DateTimeParts;
}

function sameParts(left: DateTimeParts, right: DateTimeParts): boolean {
  return Object.keys(left).every((key) => left[key as keyof DateTimeParts] === right[key as keyof DateTimeParts]);
}

function offsetAt(instant: number): number {
  const local = partsAt(instant);
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return (localAsUtc - Math.floor(instant / 1_000) * 1_000) / 60_000;
}

function withViennaOffset(value: string, match: RegExpMatchArray): string | undefined {
  const requested: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  const localAsUtc = Date.UTC(
    requested.year,
    requested.month - 1,
    requested.day,
    requested.hour,
    requested.minute,
    requested.second,
  );
  const utcParts = new Date(localAsUtc);
  if (
    utcParts.getUTCFullYear() !== requested.year ||
    utcParts.getUTCMonth() + 1 !== requested.month ||
    utcParts.getUTCDate() !== requested.day ||
    utcParts.getUTCHours() !== requested.hour ||
    utcParts.getUTCMinutes() !== requested.minute ||
    utcParts.getUTCSeconds() !== requested.second
  ) {
    return undefined;
  }

  const possibleOffsets = new Set([
    offsetAt(localAsUtc - 36 * 60 * 60 * 1_000),
    offsetAt(localAsUtc),
    offsetAt(localAsUtc + 36 * 60 * 60 * 1_000),
  ]);
  const matchingOffset = [...possibleOffsets]
    .sort((left, right) => right - left)
    .find((offset) => sameParts(partsAt(localAsUtc - offset * 60_000), requested));
  if (matchingOffset === undefined) return undefined;

  const sign = matchingOffset >= 0 ? '+' : '-';
  const absolute = Math.abs(matchingOffset);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${value}${sign}${hours}:${minutes}`;
}

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
    throw new HttpError(400, 'time must be an ISO-8601 datetime; values without an offset are interpreted in Europe/Vienna.');
  }
  const normalized = value.trim();
  if (offsetDateTime.test(normalized) && Number.isFinite(Date.parse(normalized))) {
    return normalized;
  }
  const localMatch = normalized.match(localDateTime);
  const normalizedLocal = localMatch && withViennaOffset(normalized, localMatch);
  if (!normalizedLocal || !Number.isFinite(Date.parse(normalizedLocal))) {
    throw new HttpError(400, 'time must be an ISO-8601 datetime; values without an offset are interpreted in Europe/Vienna.');
  }
  return normalizedLocal;
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
