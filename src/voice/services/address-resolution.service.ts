import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MapboxService } from '../../mapbox/mapbox.service.js';
import type { LocationCandidate } from '../../mapbox/mapbox.types.js';
import type { AddressCandidate, AddressState, CandidateKind } from '../session/call-session.types.js';

@Injectable()
export class AddressResolutionService {
  public constructor(@Inject(MapboxService) private readonly mapbox: MapboxService) {}

  public searchPostcode(postcode: string): Promise<AddressCandidate[]> {
    return this.search(`${postcode} Österreich`, 'CITY', postcode);
  }

  public searchCity(city: string, postcode?: string): Promise<AddressCandidate[]> {
    return this.search([postcode, city, 'Österreich'].filter(Boolean).join(' '), 'CITY', postcode);
  }

  public searchAddress(address: AddressState): Promise<AddressCandidate[]> {
    const query = [address.street, address.houseNumber, address.postcode, address.city, 'Österreich']
      .filter(Boolean)
      .join(' ');
    return this.search(query, 'ADDRESS', address.postcode, address.city);
  }

  private async search(
    query: string,
    kind: CandidateKind,
    postcode?: string,
    city?: string,
  ): Promise<AddressCandidate[]> {
    const result = await this.mapbox.searchLocations(query);
    return result.candidates.map((candidate) => this.candidate(candidate, kind, postcode, city));
  }

  private candidate(
    candidate: LocationCandidate,
    kind: CandidateKind,
    postcode?: string,
    requestedCity?: string,
  ): AddressCandidate {
    const city = kind === 'CITY' ? candidate.publicName || requestedCity : requestedCity;
    return {
      id: randomUUID(),
      displayName: candidate.addressLine || candidate.publicName,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      kind,
      ...(city ? { city } : {}),
      ...(postcode ? { postcode } : {}),
    };
  }
}
