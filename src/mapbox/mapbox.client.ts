import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../common/errors/http.error.js';
import { UpstreamHttpClient } from '../common/http/upstream-http.client.js';
import { APP_CONFIG } from '../config/configuration.js';
import type { AppConfig } from '../config/config.types.js';
import type { LocationCandidate, LocationSearchResult, StructuredAddressQuery } from './mapbox.types.js';

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

function candidate(value: unknown, includeDetails: boolean): LocationCandidate | null {
  const feature = record(value);
  const properties = record(feature?.properties) ?? {};
  const coordinates = record(properties.coordinates) ?? {};
  const geometry = record(feature?.geometry);
  const context = record(properties.context) ?? {};
  const contextAddress = record(context.address);
  const contextStreet = record(context.street);
  const postcode = record(context.postcode);
  const contextPlace = record(context.place);
  const matchCodeRecord = record(properties.match_code);
  const geometryCoordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
  const longitude = number(coordinates.longitude) ?? number(geometryCoordinates[0]);
  const latitude = number(coordinates.latitude) ?? number(geometryCoordinates[1]);
  if (longitude === undefined || latitude === undefined) return null;

  const name = string(properties.name);
  const placeFormatted = string(properties.place_formatted);
  const externalId = string(feature?.id);
  const featureType = string(properties.feature_type);
  const postcodeName = string(postcode?.name);
  const cityName = string(contextPlace?.name);
  const houseNumber = string(properties.address_number) ?? string(contextAddress?.address_number);
  const streetName = string(contextStreet?.name) ?? string(contextAddress?.street_name) ?? name;
  const matchCode = matchCodeRecord
    ? Object.fromEntries(Object.entries(matchCodeRecord).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : undefined;
  return {
    publicName: string(properties.name_preferred) ?? name ?? '',
    addressLine: string(properties.full_address) ?? [name, placeFormatted].filter(Boolean).join(', '),
    longitude,
    latitude,
    ...(includeDetails && externalId ? { externalId } : {}),
    ...(includeDetails && featureType ? { featureType } : {}),
    ...(includeDetails && postcodeName ? { postcode: postcodeName } : {}),
    ...(includeDetails && cityName ? { city: cityName } : {}),
    ...(includeDetails && streetName ? { street: streetName } : {}),
    ...(includeDetails && houseNumber ? { houseNumber } : {}),
    ...(includeDetails && matchCode && Object.keys(matchCode).length > 0 ? { matchCode } : {}),
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

    return this.request(new URLSearchParams({
      q: query.trim(),
    }), false);
  }

  public async geocodeAddress(address: StructuredAddressQuery): Promise<LocationSearchResult> {
    return this.request(new URLSearchParams({
      address_number: address.houseNumber,
      street: address.street,
      postcode: address.postcode,
      place: address.city,
    }), true);
  }

  private async request(parameters: URLSearchParams, includeDetails: boolean): Promise<LocationSearchResult> {
    if (!this.config.mapboxToken) {
      throw new HttpError(503, 'Set your own MAPBOX_ACCESS_TOKEN in .env to use geocoding.');
    }
    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
    for (const [key, value] of Object.entries({
      access_token: this.config.mapboxToken,
      country: 'AT', language: 'de', limit: '5', autocomplete: 'false', permanent: 'true',
    })) parameters.set(key, value);
    url.search = parameters.toString();

    const result = await this.http.requestJson(url.toString(), {}, 'Mapbox');
    const response = record(result);
    if (!Array.isArray(response?.features)) {
      throw new HttpError(502, 'Mapbox returned an unexpected response.');
    }
    return {
      candidates: response.features
        .map((item) => candidate(item, includeDetails))
        .filter((item): item is LocationCandidate => item !== null),
      attribution: string(response.attribution) ?? '',
    };
  }
}
