import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG } from '../config/configuration.js';
import type { AppConfig } from '../config/config.types.js';
import { HttpError } from '../common/errors/http.error.js';
import { UpstreamHttpClient } from '../common/http/upstream-http.client.js';
import { CLOCK, type Clock } from '../common/providers/runtime.providers.js';
import { equalSecret } from '../common/guards/api-key.guard.js';
import type { AuthStatus, LoginCallback, PendingLogin, TokenResponse, TokenSet } from './auth.types.js';

function isTokenResponse(value: unknown): value is TokenResponse {
  if (!value || typeof value !== 'object') return false;
  const token = value as Record<string, unknown>;
  return (
    typeof token.access_token === 'string' &&
    Boolean(token.access_token) &&
    typeof token.refresh_token === 'string' &&
    Boolean(token.refresh_token) &&
    typeof token.token_type === 'string' &&
    token.token_type.toLowerCase() === 'bearer' &&
    typeof token.expires_in === 'number' &&
    Number.isFinite(token.expires_in) &&
    token.expires_in > 0
  );
}

@Injectable()
export class AuthService {
  // One test passenger per process; multi-user deployments need user-scoped storage.
  private tokens: TokenSet | null = null;
  private pending: PendingLogin | null = null;
  private refreshing: Promise<string> | null = null;
  private generation = 0;

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly now: Clock,
    @Inject(UpstreamHttpClient) private readonly http: UpstreamHttpClient,
  ) {}

  public beginLogin(): { url: string; state: string } {
    this.logout();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    this.pending = { state, verifier, expiresAt: this.now() + 600_000 };

    const url = new URL(`${this.config.issuer}/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      audience: this.config.audience,
      redirect_uri: this.config.redirectUri,
      scope: 'openid profile email offline_access',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      state,
      prompt: 'login',
    }).toString();
    return { url: url.toString(), state };
  }

  public async finishLogin({ code, state, cookieState }: LoginCallback): Promise<void> {
    if (
      !this.pending ||
      this.pending.expiresAt <= this.now() ||
      !equalSecret(state, this.pending.state) ||
      !equalSecret(cookieState, this.pending.state)
    ) {
      throw new HttpError(400, 'Invalid or expired login state. Start login again in the same browser.');
    }

    const verifier = this.pending.verifier;
    this.pending = null;
    if (typeof code !== 'string' || !code) {
      throw new HttpError(400, 'Missing authorization code. Start login again.');
    }

    const version = this.generation;
    this.acceptTokens(
      await this.exchange({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: this.config.redirectUri,
      }),
      version,
    );
  }

  public async getAccessToken(): Promise<string> {
    if (this.tokens && this.tokens.expiresAt - this.now() > 30_000) return this.tokens.access;
    if (this.refreshing) return this.refreshing;
    if (!this.tokens?.refresh) throw this.loginRequired();

    const version = this.generation;
    const refresh = this.tokens.refresh;
    this.tokens = null;
    const task = (async (): Promise<string> => {
      try {
        this.acceptTokens(await this.exchange({ grant_type: 'refresh_token', refresh_token: refresh }), version);
        if (!this.tokens) throw this.loginRequired();
        return this.tokens.access;
      } catch {
        if (version === this.generation) this.tokens = null;
        throw this.loginRequired();
      }
    })();

    this.refreshing = task;
    try {
      return await task;
    } finally {
      if (this.refreshing === task) this.refreshing = null;
    }
  }

  public status(): AuthStatus {
    return {
      authenticated: Boolean(this.tokens || this.refreshing),
      expiresAt: this.tokens ? new Date(this.tokens.expiresAt).toISOString() : null,
    };
  }

  public logout(): void {
    this.generation += 1;
    this.tokens = null;
    this.pending = null;
    this.refreshing = null;
  }

  private async exchange(form: Record<string, string>): Promise<unknown> {
    return this.http.requestJson(
      `${this.config.issuer}/oauth/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.config.clientId, ...form }).toString(),
      },
      'Auth0',
    );
  }

  private acceptTokens(result: unknown, version: number): void {
    if (version !== this.generation) throw this.loginRequired();
    if (!isTokenResponse(result)) {
      throw new HttpError(
        401,
        'Auth0 did not return usable access/refresh tokens. Check offline_access and Refresh Token Rotation.',
      );
    }
    this.tokens = {
      access: result.access_token,
      refresh: result.refresh_token,
      expiresAt: this.now() + result.expires_in * 1000,
    };
  }

  private loginRequired(): HttpError {
    return new HttpError(401, 'Login required. Open the starter and sign in again.');
  }
}
