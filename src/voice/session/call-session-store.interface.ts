import type { AddressPatch, AddressSide, CallSession } from './call-session.types.js';

export const CALL_SESSION_STORE = Symbol('CALL_SESSION_STORE');

export interface CallSessionStore {
  get(callId: string): CallSession | undefined;
  getOrCreate(callId: string): CallSession;
  save(session: CallSession): CallSession;
  delete(callId: string): boolean;
  updateAddress(callId: string, side: AddressSide, partialAddress: AddressPatch): CallSession;
  confirmCandidate(callId: string, side: AddressSide, candidateId: string): CallSession;
  runExclusive<T>(callId: string, operation: () => Promise<T> | T): Promise<T>;
}
