import type { ProcessedTripSearch } from '../string-processing/string-processing.types.js';

type UnknownRecord = Record<string, unknown>;

export interface FonioRideDetails {
  readonly rideId: string;
  readonly driverName: string;
  readonly pickupTimeIsEstimated: boolean;
}

export interface FonioTripSearchResponse {
  readonly status: 'ride_found' | 'no_ride_found';
  readonly rideDetails?: FonioRideDetails;
  readonly pickupAddress: string;
  readonly destinationAddress: string;
  readonly pickupTime: string;
  readonly message?: string;
}

const viennaDate = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'Europe/Vienna',
  day: 'numeric',
  month: 'long',
});
const viennaTime = new Intl.DateTimeFormat('de-AT', {
  timeZone: 'Europe/Vienna',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const viennaIsoParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstRide(value: unknown): UnknownRecord | undefined {
  return Array.isArray(value) ? record(value[0]) : undefined;
}

function viennaIso(value: string): string | undefined {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return undefined;

  const parts = Object.fromEntries(
    viennaIsoParts.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const offset = parts.timeZoneName?.replace('GMT', '');
  if (!offset) return undefined;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

function driverName(suggestion: UnknownRecord): string {
  const driver = record(suggestion.driver);
  return text(driver?.firstName) ?? text(driver?.name) ?? text(driver?.fullName) ?? 'Unbekannt';
}

function foundMessage(
  details: FonioRideDetails,
  pickupTime: string,
  request: ProcessedTripSearch,
): string {
  const instant = new Date(pickupTime);
  const date = viennaDate.format(instant);
  const time = viennaTime.format(instant);
  const estimate = details.pickupTimeIsEstimated ? 'voraussichtlich ' : '';
  return `Ich habe eine passende Fahrt mit ${details.driverName} gefunden. Abholung ist ${estimate}am ${date} um ${time} Uhr am ${request.departure}. Dein Ziel ist ${request.destination}. Soll ich diese Fahrt für dich anfragen?`;
}

export function fonioTripSearchResponse(
  mobieResponse: unknown,
  request: ProcessedTripSearch,
): FonioTripSearchResponse {
  const suggestion = firstRide(mobieResponse);
  const ride = record(suggestion?.ride);
  const rideId = text(ride?.id);
  const estimatedPickupTime = text(suggestion?.pickupEta);
  const pickupTime = estimatedPickupTime ? viennaIso(estimatedPickupTime) ?? estimatedPickupTime : request.time;

  if (!suggestion || !rideId) {
    return {
      status: 'no_ride_found',
      pickupAddress: request.departure,
      destinationAddress: request.destination,
      pickupTime,
      message: 'Ich habe derzeit keine passende Fahrt gefunden.',
    };
  }

  const rideDetails: FonioRideDetails = {
    rideId,
    driverName: driverName(suggestion),
    pickupTimeIsEstimated: estimatedPickupTime !== undefined,
  };
  return {
    status: 'ride_found',
    rideDetails,
    pickupAddress: request.departure,
    destinationAddress: request.destination,
    pickupTime,
    message: foundMessage(rideDetails, pickupTime, request),
  };
}
