import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';
import { MapboxClient } from './mapbox.client.js';
import type { LocationSearchResult, StructuredAddressQuery } from './mapbox.types.js';

@Injectable()
export class MapboxService {
  public constructor(@Inject(MapboxClient) private readonly client: MapboxClient) {}

  public searchLocations(query: string): Promise<LocationSearchResult> {
    if (!query.trim() || query.length > 256 || query.includes(';') || query.trim().split(/\s+/).length > 20) {
      throw new HttpError(400, 'query must contain 1–256 characters, at most 20 words and no semicolon.');
    }
    return this.client.searchLocations(query);
  }

  public geocodeAddress(address: StructuredAddressQuery): Promise<LocationSearchResult> {
    for (const value of [address.street, address.houseNumber, address.postcode, address.city]) {
      if (!value.trim() || value.length > 200 || value.includes(';')) {
        throw new HttpError(400, 'Structured address fields must be non-empty, bounded strings without semicolons.');
      }
    }
    return this.client.geocodeAddress(address);
  }
}
