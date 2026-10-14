import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';
import { MapboxClient } from './mapbox.client.js';
import type { LocationSearchResult } from './mapbox.types.js';

@Injectable()
export class MapboxService {
  public constructor(@Inject(MapboxClient) private readonly client: MapboxClient) {}

  public searchLocations(query: string): Promise<LocationSearchResult> {
    if (!query.trim() || query.length > 256 || query.includes(';') || query.trim().split(/\s+/).length > 20) {
      throw new HttpError(400, 'query must contain 1–256 characters, at most 20 words and no semicolon.');
    }
    return this.client.searchLocations(query);
  }
}
