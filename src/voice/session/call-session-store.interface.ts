import type { AddressPatch, AddressSide, CallSession } from './call-session.types.js';

export const CALL_SESSION_STORE = Symbol('CALL_SESSION_STORE');

export interface CallSessionStore {
  get(sessionId: string): CallSession | undefined;
  getOrCreate(sessionId: string): CallSession;
  save(session: CallSession): CallSession;
  delete(sessionId: string): boolean;
  updateAddress(sessionId: string, side: AddressSide, partialAddress: AddressPatch): CallSession;
  confirmCandidate(sessionId: string, side: AddressSide, candidateId: string): CallSession;
  runExclusive<T>(sessionId: string, operation: () => Promise<T> | T): Promise<T>;
}
