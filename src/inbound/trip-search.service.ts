import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';
import { MapboxService } from '../mapbox/mapbox.service.js';
import type { LocationCandidate } from '../mapbox/mapbox.types.js';
import { MobieService } from '../mobie/mobie.service.js';
import { StringProcessingService } from '../string-processing/string-processing.service.js';
import type { TripSearchStrings } from '../string-processing/string-processing.types.js';

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
  readonly response: unknown;
}

@Injectable()
export class TripSearchService {
  private readonly records: TripSearchRecord[] = [];

  public constructor(
    @Inject(StringProcessingService) private readonly strings: StringProcessingService,
    @Inject(MapboxService) private readonly mapbox: MapboxService,
    @Inject(MobieService) private readonly mobie: MobieService,
  ) { }

  public async search(input: TripSearchStrings): Promise<unknown> {
    const request = this.strings.processTripSearch(input);
    const [departureSearch, destinationSearch] = await Promise.all([
      this.mapbox.searchLocations(request.departure),
      this.mapbox.searchLocations(request.destination),
    ]);

    const departure = departureSearch.candidates[0];
    const destination = destinationSearch.candidates[0];
    if (!departure) throw new HttpError(404, `No Mapbox candidate found for departure: ${request.departure}`);
    if (!destination) throw new HttpError(404, `No Mapbox candidate found for destination: ${request.destination}`);

    const response = await this.mobie.searchRides({
      departure,
      destination,
      time: request.time,
      seatsRequested: request.seatsRequested,
    });
    this.records.unshift({
      id: randomUUID(),
      receivedAt: new Date().toISOString(),
      request,
      resolved: { departure, destination },
      response,
    });
    if (this.records.length > 20) this.records.pop();
    return response;
  }

  public latest(): { result: TripSearchRecord | null } {
    return { result: this.records[0] ?? null };
  }
}
