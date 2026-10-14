export interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly token_type: string;
  readonly expires_in: number;
}

export interface TokenSet {
  readonly access: string;
  readonly refresh: string;
  readonly expiresAt: number;
}

export interface PendingLogin {
  readonly state: string;
  readonly verifier: string;
  readonly expiresAt: number;
}

export interface LoginCallback {
  readonly code: unknown;
  readonly state: unknown;
  readonly cookieState: string | undefined;
}

export interface AuthStatus {
  readonly authenticated: boolean;
  readonly expiresAt: string | null;
}
