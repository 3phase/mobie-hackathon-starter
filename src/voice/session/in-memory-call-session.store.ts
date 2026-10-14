import { Injectable } from '@nestjs/common';
import { HttpError } from '../../common/errors/http.error.js';
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
    ...(merged.street ? { street: merged.street } : {}),
    ...(merged.houseNumber ? { houseNumber: merged.houseNumber } : {}),
    status: 'COLLECTING',
    candidates: [],
  };
}

@Injectable()
export class InMemoryCallSessionStore implements CallSessionStore {
  private readonly sessions = new Map<string, CallSession>();
  private readonly locks = new Map<string, Promise<void>>();

  public constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = CALL_SESSION_TTL_MS,
  ) {}

  public get(callId: string): CallSession | undefined {
    const id = this.callId(callId);
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (this.now() - session.updatedAt >= this.ttlMs) {
      this.sessions.delete(id);
      return undefined;
    }
    return clone(session);
  }

  public getOrCreate(callId: string): CallSession {
    const id = this.callId(callId);
    const existing = this.get(id);
    if (existing) return existing;
    const now = this.now();
    const session: CallSession = {
      callId: id,
      origin: initialAddress(),
      destination: initialAddress(),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    return clone(session);
  }

  public save(session: CallSession): CallSession {
    const callId = this.callId(session.callId);
    const saved = clone({ ...session, callId, updatedAt: this.now() });
    this.sessions.set(callId, saved);
    return clone(saved);
  }

  public delete(callId: string): boolean {
    return this.sessions.delete(this.callId(callId));
  }

  public updateAddress(callId: string, side: AddressSide, partialAddress: AddressPatch): CallSession {
    const session = this.getOrCreate(callId);
    const current = session[side];
    const changed = (Object.keys(partialAddress) as (keyof AddressPatch)[])
      .some((key) => partialAddress[key] !== undefined && partialAddress[key] !== current[key]);
    const next: AddressState = changed ? collectingAddress(current, partialAddress) : { ...current, ...partialAddress };
    return this.save({ ...session, [side]: next });
  }

  public confirmCandidate(callId: string, side: AddressSide, candidateId: string): CallSession {
    const session = this.get(callId);
    if (!session) throw new HttpError(409, 'The call session is missing or expired.');
    const current = session[side];
    const candidate = current.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new HttpError(409, 'The candidate is invalid or belongs to stale address context.');

    if (candidate.kind === 'CITY') {
      const next: AddressState = collectingAddress({
        ...current,
        ...(candidate.city ? { city: candidate.city } : {}),
        ...(candidate.postcode ? { postcode: candidate.postcode } : {}),
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
      status: 'CONFIRMED',
      candidates: [],
      resolvedLocation,
    };
    return this.save({ ...session, [side]: next });
  }

  public async runExclusive<T>(callId: string, operation: () => Promise<T> | T): Promise<T> {
    const id = this.callId(callId);
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

  private callId(value: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 256) {
      throw new HttpError(400, 'callId must be a non-empty string of at most 256 characters.');
    }
    return normalized;
  }
}
