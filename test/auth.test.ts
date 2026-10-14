import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AuthService } from '../src/auth/auth.service.js';
import { UpstreamHttpClient } from '../src/common/http/upstream-http.client.js';
import type { AppConfig } from '../src/config/config.types.js';
import type { FetchFunction } from '../src/common/providers/runtime.providers.js';

const config: AppConfig = {
  issuer: 'https://tenant.example',
  clientId: 'public-client',
  audience: 'https://staging.example',
  redirectUri: 'http://localhost:3000/callback',
  baseUrl: 'https://staging.example',
  apiKey: 'test-key-with-at-least-32-characters',
  mapboxToken: '',
  port: 3000,
  host: '127.0.0.1',
};

const tokenResponse = (access: string, refresh?: string, expires = 120): Response =>
  Response.json({ access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: expires });

function createAuth(fetch: FetchFunction, now: () => number = Date.now): AuthService {
  return new AuthService(config, now, new UpstreamHttpClient(fetch));
}

async function login(auth: AuthService): Promise<void> {
  const { state } = auth.beginLogin();
  await auth.finishLogin({ code: 'code', state, cookieState: state });
}

test('authorization code exchange binds state to the browser and uses the matching PKCE verifier', async () => {
  let sent: URLSearchParams | undefined;
  const fetch: FetchFunction = async (input, init) => {
    assert.equal(input, 'https://tenant.example/oauth/token');
    assert.equal(typeof init?.body, 'string');
    sent = new URLSearchParams(init?.body as string);
    return tokenResponse('access-1', 'refresh-1');
  };
  const auth = createAuth(fetch);
  const { url, state } = auth.beginLogin();
  const params = new URL(url).searchParams;
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.equal(params.get('audience'), 'https://staging.example');
  assert.match(params.get('scope') ?? '', /offline_access/);
  await assert.rejects(auth.finishLogin({ code: 'code', state, cookieState: 'other-browser' }), /state/i);
  assert.equal(sent, undefined);
  await auth.finishLogin({ code: 'code', state, cookieState: state });
  const exchange = sent as URLSearchParams | undefined;
  assert.ok(exchange);
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.equal(exchange.get('redirect_uri'), config.redirectUri);
  assert.equal(
    createHash('sha256').update(exchange.get('code_verifier') ?? '').digest('base64url'),
    params.get('code_challenge'),
  );
  assert.equal(await auth.getAccessToken(), 'access-1');
  await assert.rejects(auth.finishLogin({ code: 'code', state, cookieState: state }), /state/i);
  assert.doesNotMatch(JSON.stringify(auth.status()), /access-1|refresh-1/);
});

test('expired login transactions cannot be exchanged', async () => {
  let now = 0;
  const auth = createAuth(async () => assert.fail('No token request expected'), () => now);
  const { state } = auth.beginLogin();
  now = 11 * 60_000;
  await assert.rejects(auth.finishLogin({ code: 'code', state, cookieState: state }), /state|expired/i);
});

test('concurrent calls perform one refresh and subsequent refresh uses the rotated token', async () => {
  let now = 0;
  const refreshes: string[] = [];
  const fetch: FetchFunction = async (_input, init) => {
    const form = new URLSearchParams(init?.body as string);
    if (form.get('grant_type') === 'authorization_code') return tokenResponse('access-1', 'refresh-1');
    refreshes.push(form.get('refresh_token') ?? '');
    await new Promise((resolve) => setTimeout(resolve, 10));
    return tokenResponse(`access-${refreshes.length + 1}`, `refresh-${refreshes.length + 1}`);
  };
  const auth = createAuth(fetch, () => now);
  await login(auth);
  now = 100_000;
  assert.deepEqual(await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]), [
    'access-2',
    'access-2',
    'access-2',
  ]);
  now = 200_000;
  assert.equal(await auth.getAccessToken(), 'access-3');
  assert.deepEqual(refreshes, ['refresh-1', 'refresh-2']);
});

test('failed refresh requires login instead of reusing a possibly consumed refresh token', async () => {
  let now = 0;
  let calls = 0;
  const auth = createAuth(async () => {
    calls += 1;
    return calls === 1
      ? tokenResponse('access', 'secret-refresh')
      : Response.json({ error: 'invalid_grant', error_description: 'secret-refresh' }, { status: 400 });
  }, () => now);
  await login(auth);
  now = 100_000;
  await assert.rejects(
    auth.getAccessToken(),
    (error: unknown) => error instanceof Error && !error.message.includes('secret-refresh') && 'status' in error && error.status === 401,
  );
  await assert.rejects(auth.getAccessToken(), /login/i);
  assert.equal(calls, 2);
  assert.equal(auth.status().authenticated, false);
});

test('logout during refresh cannot resurrect the logged-out session', async () => {
  let now = 0;
  let release: (() => void) | undefined;
  const auth = createAuth(async (_input, init) => {
    const form = new URLSearchParams(init?.body as string);
    if (form.get('grant_type') === 'authorization_code') return tokenResponse('old', 'refresh');
    return new Promise<Response>((resolve) => {
      release = () => resolve(tokenResponse('new', 'rotated'));
    });
  }, () => now);
  await login(auth);
  now = 100_000;
  const pending = auth.getAccessToken();
  auth.logout();
  release?.();
  await assert.rejects(pending, /login|session/i);
  assert.equal(auth.status().authenticated, false);
});

test('missing refresh token is reported instead of promising automatic renewal', async () => {
  const auth = createAuth(async () => tokenResponse('access'));
  await assert.rejects(login(auth), /offline_access|refresh/i);
  assert.equal(auth.status().authenticated, false);
});
