import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { MapboxService } from '../../mapbox/mapbox.service.js';
import type { LocationCandidate } from '../../mapbox/mapbox.types.js';
import { PostcodeCacheService } from '../cache/postcode-cache.service.js';
import { OpenPlzService } from '../providers/openplz.service.js';
import type { LocalityEntry, MunicipalitySummary, StreetEntry } from '../providers/openplz.types.js';
import type { AddressCandidate, AddressState } from '../session/call-session.types.js';
import { canonicalCitySearch, normalizeAustrianAddress } from '../utils/austrian-address-normalizer.js';
import { StreetMatchingService, textSimilarity } from './street-matching.service.js';

function candidateId(kind: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('base64url').slice(0, 24);
  return `openplz-${kind}-${digest}`;
}

function municipalityCandidate(municipality: MunicipalitySummary, postcode?: string, score = 1): AddressCandidate {
  return {
    id: candidateId('municipality', municipality.key),
    externalId: `openplz:municipality:${municipality.key}`,
    displayName: municipality.name,
    kind: 'CITY',
    city: municipality.name,
    municipalityKey: municipality.key,
    score,
    ...(postcode ? { postcode } : {}),
  };
}

function localityCandidate(locality: LocalityEntry, score: number): AddressCandidate {
  return {
    id: candidateId('locality', locality.key, locality.postalCode),
    externalId: `openplz:locality:${locality.key}`,
    displayName: `${locality.name}, ${locality.postalCode} (${locality.municipality.name})`,
    kind: 'CITY',
    city: locality.municipality.name,
    postcode: locality.postalCode,
    locality: locality.name,
    municipalityKey: locality.municipality.key,
    localityKey: locality.key,
    score,
  };
}

function streetCandidate(street: StreetEntry, score: number): AddressCandidate {
  return {
    id: candidateId('street', street.key, street.postalCode, street.municipality.key, normalizeAustrianAddress(street.locality)),
    externalId: `openplz:street:${street.key}`,
    displayName: `${street.name}, ${street.postalCode} ${street.locality}`,
    kind: 'ADDRESS',
    city: street.municipality.name,
    postcode: street.postalCode,
    street: street.name,
    locality: street.locality,
    municipalityKey: street.municipality.key,
    streetKey: street.key,
    score,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class AddressResolutionService {
  private readonly logger = new Logger(AddressResolutionService.name);

  public constructor(
    @Inject(PostcodeCacheService) private readonly cache: PostcodeCacheService,
    @Inject(OpenPlzService) private readonly openPlz: OpenPlzService,
    @Inject(StreetMatchingService) private readonly streetMatcher: StreetMatchingService,
    @Inject(MapboxService) private readonly mapbox: MapboxService,
  ) {}

  public async searchPostcode(postcode: string): Promise<AddressCandidate[]> {
    const data = await this.cache.get(postcode);
    const municipalities = new Map<string, MunicipalitySummary>();
    for (const locality of data.localities) municipalities.set(locality.municipality.key, locality.municipality);
    return [...municipalities.values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'de-AT'))
      .map((municipality) => municipalityCandidate(municipality, postcode));
  }

  public async searchCity(city: string, postcode?: string): Promise<AddressCandidate[]> {
    const search = canonicalCitySearch(city);
    const localities = postcode
      ? (await this.cache.get(postcode)).localities
      : await this.openPlz.searchLocalities(`^${escapeRegex(search)}`);
    const candidates = new Map<string, AddressCandidate>();
    const municipalities = new Map<string, MunicipalitySummary>();
    for (const locality of localities) municipalities.set(locality.municipality.key, locality.municipality);
    for (const municipality of municipalities.values()) {
      const score = textSimilarity(search, municipality.name);
      if (score >= 0.58) candidates.set(`municipality:${municipality.key}`, municipalityCandidate(municipality, postcode, score));
    }
    for (const locality of localities) {
      const score = textSimilarity(search, locality.name);
      if (score >= 0.58 && normalizeAustrianAddress(locality.name) !== normalizeAustrianAddress(locality.municipality.name)) {
        candidates.set(`locality:${locality.key}:${locality.postalCode}`, localityCandidate(locality, score));
      }
    }
    return [...candidates.values()]
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0)
        || left.displayName.localeCompare(right.displayName, 'de-AT'))
      .slice(0, 5);
  }

  public async searchAddress(address: AddressState): Promise<AddressCandidate[]> {
    if (!address.postcode || !address.street) return [];
    const startedAt = Date.now();
    const data = await this.cache.get(address.postcode);
    const pool = data.streets.filter((street) => street.postalCode === address.postcode)
      .filter((street) => !address.municipalityKey || street.municipality.key === address.municipalityKey)
      .filter((street) => !address.locality || normalizeAustrianAddress(street.locality) === normalizeAustrianAddress(address.locality));
    const ranked = this.streetMatcher.rank(address.street, pool);
    this.logger.log(`Ranked ${pool.length} OpenPLZ streets in ${Date.now() - startedAt}ms.`);
    const first = ranked[0];
    if (!first) return [];
    const second = ranked[1];
    const clearlySeparated = first.score >= 0.86 && (!second || first.score - second.score >= 0.08);
    return (clearlySeparated ? [first] : ranked).map(({ street, score }) => streetCandidate(street, score));
  }

  public async geocodeAddress(address: AddressState, selected: AddressCandidate): Promise<AddressCandidate[]> {
    const street = selected.street;
    const postcode = selected.postcode ?? address.postcode;
    const city = selected.city ?? address.city;
    if (!street || !postcode || !city || !address.houseNumber) return [];
    const result = await this.mapbox.geocodeAddress({ street, houseNumber: address.houseNumber, postcode, city });
    return result.candidates
      .filter((candidate) => this.validFinalCandidate(candidate, street, address.houseNumber!, postcode))
      .map((candidate) => ({
        ...selected,
        id: candidateId('geocode', candidate.externalId ?? candidate.addressLine, street, address.houseNumber!, postcode),
        displayName: candidate.addressLine,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        ...(candidate.externalId ? { externalId: candidate.externalId } : {}),
      }));
  }

  private validFinalCandidate(candidate: LocationCandidate, street: string, houseNumber: string, postcode: string): boolean {
    if (candidate.featureType !== 'address' || candidate.postcode !== postcode) return false;
    if (!candidate.street || textSimilarity(candidate.street, street) < 0.9) return false;
    if (!candidate.houseNumber || normalizeAustrianAddress(candidate.houseNumber) !== normalizeAustrianAddress(houseNumber)) return false;
    const match = candidate.matchCode;
    if (match && ['address_number', 'street', 'postcode'].some((key) => match[key] === 'unmatched')) return false;
    return candidate.latitude >= -90 && candidate.latitude <= 90
      && candidate.longitude >= -180 && candidate.longitude <= 180;
  }
}
