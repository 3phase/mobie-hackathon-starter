import { Inject, Injectable } from '@nestjs/common';
import { HttpError } from '../../common/errors/http.error.js';
import { CLOCK, type Clock } from '../../common/providers/runtime.providers.js';
import type { CallSessionStore } from './call-session-store.interface.js';
import {
  AddressSide,
  type AddressPatch,
  type AddressState,
  type CallSession,
  type ResolvedLocation,
} from './call-session.types.js';

export const CALL_SESSION_TTL_MS = 45 * 60 * 1_000;

function initialAddress(): AddressState {
  return { status: 'COLLECTING', candidates: [] };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function collectingAddress(address: AddressState, patch: AddressPatch = {}): AddressState {
  const merged = { ...address, ...patch };
  return {
    ...(merged.postcode ? { postcode: merged.postcode } : {}),
    ...(merged.city ? { city: merged.city } : {}),
    ...(merged.locality ? { locality: merged.locality } : {}),
    ...(merged.municipalityKey ? { municipalityKey: merged.municipalityKey } : {}),
    ...(merged.localityKey ? { localityKey: merged.localityKey } : {}),
    ...(merged.street ? { street: merged.street } : {}),
    ...(merged.streetKey ? { streetKey: merged.streetKey } : {}),
    ...(merged.houseNumber ? { houseNumber: merged.houseNumber } : {}),
    status: 'COLLECTING',
    candidates: [],
  };
}

@Injectable()
export class InMemoryCallSessionStore implements CallSessionStore {
  private readonly sessions = new Map<string, CallSession>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly ttlMs = CALL_SESSION_TTL_MS;

  public constructor(@Inject(CLOCK) private readonly now: Clock = Date.now) { }

  public get(sessionId: string): CallSession | undefined {
    const id = this.sessionId(sessionId);
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (this.now() - session.updatedAt >= this.ttlMs) {
      this.sessions.delete(id);
      return undefined;
    }
    return clone(session);
  }

  public getOrCreate(sessionId: string): CallSession {
    const id = this.sessionId(sessionId);
    const existing = this.get(id);
    if (existing) return existing;
    const now = this.now();
    const session: CallSession = {
      sessionId: id,
      origin: initialAddress(),
      destination: initialAddress(),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    return clone(session);
  }

  public save(session: CallSession): CallSession {
    const sessionId = this.sessionId(session.sessionId);
    const saved = clone({ ...session, sessionId, updatedAt: this.now() });
    this.sessions.set(sessionId, saved);
    return clone(saved);
  }

  public delete(sessionId: string): boolean {
    return this.sessions.delete(this.sessionId(sessionId));
  }

  public updateAddress(sessionId: string, side: AddressSide, partialAddress: AddressPatch): CallSession {
    const session = this.getOrCreate(sessionId);
    const current = session[side];
    const changed = (Object.keys(partialAddress) as (keyof AddressPatch)[])
      .some((key) => partialAddress[key] !== undefined && partialAddress[key] !== current[key]);
    let source = current;
    if (partialAddress.postcode !== undefined && partialAddress.postcode !== current.postcode) {
      source = initialAddress();
    } else if (partialAddress.city !== undefined && partialAddress.city !== current.city) {
      source = {
        ...(current.postcode ? { postcode: current.postcode } : {}),
        status: 'COLLECTING',
        candidates: [],
      };
    } else if (partialAddress.street !== undefined && partialAddress.street !== current.street) {
      source = {
        ...(current.postcode ? { postcode: current.postcode } : {}),
        ...(current.city ? { city: current.city } : {}),
        ...(current.locality ? { locality: current.locality } : {}),
        ...(current.municipalityKey ? { municipalityKey: current.municipalityKey } : {}),
        ...(current.localityKey ? { localityKey: current.localityKey } : {}),
        ...(current.houseNumber ? { houseNumber: current.houseNumber } : {}),
        status: 'COLLECTING',
        candidates: [],
      };
    }
    const next: AddressState = changed ? collectingAddress(source, partialAddress) : { ...current, ...partialAddress };
    return this.save({ ...session, [side]: next });
  }

  public confirmCandidate(sessionId: string, side: AddressSide, candidateId: string): CallSession {
    const session = this.get(sessionId);
    if (!session) throw new HttpError(409, 'The call session is missing or expired.');
    const current = session[side];
    const candidate = current.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new HttpError(409, 'The candidate is invalid or belongs to stale address context.');

    if (candidate.kind === 'CITY') {
      const next: AddressState = collectingAddress({
        ...(candidate.postcode ?? current.postcode ? { postcode: candidate.postcode ?? current.postcode } : {}),
        ...(candidate.city ? { city: candidate.city } : {}),
        ...(candidate.locality ? { locality: candidate.locality } : {}),
        ...(candidate.municipalityKey ? { municipalityKey: candidate.municipalityKey } : {}),
        ...(candidate.localityKey ? { localityKey: candidate.localityKey } : {}),
        status: 'COLLECTING',
        candidates: [],
      });
      return this.save({ ...session, [side]: next });
    }

    if (candidate.latitude === undefined || candidate.longitude === undefined) {
      throw new HttpError(409, 'The selected address candidate has no verified coordinates.');
    }
    const resolvedLocation: ResolvedLocation = {
      displayName: candidate.displayName,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      ...(candidate.externalId ? { externalId: candidate.externalId } : {}),
    };
    const next: AddressState = {
      ...current,
      ...(candidate.city ? { city: candidate.city } : {}),
      ...(candidate.postcode ? { postcode: candidate.postcode } : {}),
      ...(candidate.street ? { street: candidate.street } : {}),
      ...(candidate.locality ? { locality: candidate.locality } : {}),
      ...(candidate.municipalityKey ? { municipalityKey: candidate.municipalityKey } : {}),
      ...(candidate.localityKey ? { localityKey: candidate.localityKey } : {}),
      ...(candidate.streetKey ? { streetKey: candidate.streetKey } : {}),
      status: 'CONFIRMED',
      candidates: [],
      resolvedLocation,
    };
    return this.save({ ...session, [side]: next });
  }

  public async runExclusive<T>(sessionId: string, operation: () => Promise<T> | T): Promise<T> {
    const id = this.sessionId(sessionId);
    const predecessor = this.locks.get(id) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = predecessor.then(() => current);
    this.locks.set(id, tail);
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  private sessionId(value: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 256) {
      throw new HttpError(400, 'sessionId must be a non-empty string of at most 256 characters.');
    }
    return normalized;
  }
}
