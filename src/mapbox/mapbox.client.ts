import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';
import { UpstreamHttpClient } from '../common/http/upstream-http.client.js';
import { APP_CONFIG } from '../config/configuration.js';
import type { AppConfig } from '../config/config.types.js';
import type { LocationCandidate, LocationSearchResult } from './mapbox.types.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function candidate(value: unknown): LocationCandidate | null {
  const feature = record(value);
  const properties = record(feature?.properties) ?? {};
  const coordinates = record(properties.coordinates) ?? {};
  const geometry = record(feature?.geometry);
  const geometryCoordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
  const longitude = number(coordinates.longitude) ?? number(geometryCoordinates[0]);
  const latitude = number(coordinates.latitude) ?? number(geometryCoordinates[1]);
  if (longitude === undefined || latitude === undefined) return null;

  const name = string(properties.name);
  const place = string(properties.place_formatted);
  return {
    publicName: string(properties.name_preferred) ?? name ?? '',
    addressLine: string(properties.full_address) ?? [name, place].filter(Boolean).join(', '),
    longitude,
    latitude,
  };
}

@Injectable()
export class MapboxClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(UpstreamHttpClient) private readonly http: UpstreamHttpClient,
  ) {}

  public async searchLocations(query: string): Promise<LocationSearchResult> {
    if (!this.config.mapboxToken) {
      throw new HttpError(503, 'Set your own MAPBOX_ACCESS_TOKEN in .env to use geocoding.');
    }

    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
    url.search = new URLSearchParams({
      q: query.trim(),
      access_token: this.config.mapboxToken,
      country: 'AT',
      language: 'de',
      limit: '5',
      autocomplete: 'false',
      permanent: 'true',
    }).toString();

    const result = await this.http.requestJson(url.toString(), {}, 'Mapbox');
    const response = record(result);
    if (!Array.isArray(response?.features)) {
      throw new HttpError(502, 'Mapbox returned an unexpected response.');
    }
    return {
      candidates: response.features.map(candidate).filter((item): item is LocationCandidate => item !== null),
      attribution: string(response.attribution) ?? '',
    };
  }
}
