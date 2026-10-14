import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';
import { MapboxService } from '../mapbox/mapbox.service.js';
import type { LocationCandidate } from '../mapbox/mapbox.types.js';
import { MobieService } from '../mobie/mobie.service.js';
import { StringProcessingService } from '../string-processing/string-processing.service.js';
import type { TripSearchStrings } from '../string-processing/string-processing.types.js';
import { fonioTripSearchResponse, type FonioTripSearchResponse } from './fonio-trip-search-response.js';

export interface TripSearchRecord {
  readonly id: string;
  readonly receivedAt: string;
  readonly request: {
    readonly departure: string;
    readonly destination: string;
    readonly time: string;
    readonly seatsRequested: number;
  };
  readonly resolved: {
    readonly departure: LocationCandidate;
    readonly destination: LocationCandidate;
  };
  readonly response: FonioTripSearchResponse;
  readonly mobieResponse: unknown;
}

export interface ResolvedTripSearchInput {
  readonly departure: LocationCandidate;
  readonly destination: LocationCandidate;
  readonly time: unknown;
  readonly seatsRequested?: unknown;
}

@Injectable()
export class TripSearchService {
  private readonly records: TripSearchRecord[] = [];

  public constructor(
    @Inject(StringProcessingService) private readonly strings: StringProcessingService,
    @Inject(MapboxService) private readonly mapbox: MapboxService,
    @Inject(MobieService) private readonly mobie: MobieService,
  ) { }

  public async search(input: TripSearchStrings): Promise<FonioTripSearchResponse> {
    const request = this.strings.processTripSearch(input);
    const [departureSearch, destinationSearch] = await Promise.all([
      this.mapbox.searchLocations(request.departure),
      this.mapbox.searchLocations(request.destination),
    ]);

    const departure = departureSearch.candidates[0];
    const destination = destinationSearch.candidates[0];
    if (!departure) throw new HttpError(404, `No Mapbox candidate found for departure: ${request.departure}`);
    if (!destination) throw new HttpError(404, `No Mapbox candidate found for destination: ${request.destination}`);

    return this.searchMobie(request, departure, destination);
  }

  public searchResolved(input: ResolvedTripSearchInput): Promise<FonioTripSearchResponse> {
    const request = this.strings.processTripSearch({
      departure: input.departure.addressLine || input.departure.publicName,
      destination: input.destination.addressLine || input.destination.publicName,
      time: input.time,
      ...(input.seatsRequested === undefined ? {} : { seatsRequested: input.seatsRequested }),
    });
    return this.searchMobie(request, input.departure, input.destination);
  }

  private async searchMobie(
    request: ReturnType<StringProcessingService['processTripSearch']>,
    departure: LocationCandidate,
    destination: LocationCandidate,
  ): Promise<FonioTripSearchResponse> {
    const mobieResponse = await this.mobie.searchRides({
      departure,
      destination,
      time: request.time,
      seatsRequested: request.seatsRequested,
    });
    const response = fonioTripSearchResponse(mobieResponse, request);
    this.records.unshift({
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      request,
      resolved: { departure, destination },
      response,
      mobieResponse,
    });
    if (this.records.length > 20) this.records.pop();
    return response;
  }

  public join(rideId: unknown): Promise<unknown> {
    if (typeof rideId !== 'string' || !rideId.trim()) {
      throw new HttpError(400, 'rideId must be a non-empty string.');
    }
    const id = rideId.trim();
    const search = this.records.find((record) => record.response.rideDetails?.rideId === id);
    if (!search) {
      throw new HttpError(404, 'Trip not found in recent searches. Search for the trip before joining it.');
    }

    return this.mobie.joinRide(id, {
      departure: search.resolved.departure,
      destination: search.resolved.destination,
      time: search.request.time,
      seatsRequested: 1,
    }, true);
  }

  public latest(): { result: TripSearchRecord | null } {
    return { result: this.records[0] ?? null };
  }
}
