# mobie Hackathon Starter

A NestJS and TypeScript starter for a German-speaking phone assistant that finds rides and submits real booking requests through the **mobie staging REST API**. It includes Auth0 Authorization Code + PKCE login, rotating refresh-token handling, Mapbox geocoding, a protected REST API, and the original browser login page.

This is still a single-user hackathon service: **one running process represents one staging passenger**. Tokens live only in memory, all callers use that passenger, and a restart requires login again. A submitted booking remains pending until the driver approves it.

Team specifications, architecture, package guides and implementation plans are in the [project documentation index](docs/README.md). The [architecture deck](docs/architecture/mobie-architecture-slides.html) describes our Fonio integration and the passenger and driver processes. Open the HTML deck locally in a browser.

## Requirements and setup

- Node.js 22 or newer (Node.js 24 LTS recommended)
- A mobie staging passenger account
- The supplied public Auth0 configuration
- A Mapbox access token only when using the included geocoder

```sh
npm install
npm run setup
npm run dev
```

`npm run setup` creates `.env` from `.env.example`, generates a random `STARTER_API_KEY`, gives the file owner-only permissions, and never overwrites an existing file. Fill in the supplied Auth0 values, then open `http://localhost:3000`, enter the team key, and sign in with the staging passenger.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `MOBIE_API_URL` | No | HTTPS staging origin; defaults to `https://api-staging.mobie.at`. The known production origin is rejected. |
| `AUTH0_DOMAIN` | Yes | Supplied Auth0 hostname without protocol or path. |
| `AUTH0_CLIENT_ID` | Yes | Supplied public client ID; no client secret is used. |
| `AUTH0_AUDIENCE` | Yes | Exact audience for the mobie staging API. |
| `AUTH0_REDIRECT_URI` | No | Exact callback ending in `/callback`; defaults to `http://localhost:3000/callback`. |
| `STARTER_API_KEY` | Yes | At least 32 characters. Protects this starter API, not mobie. |
| `MAPBOX_ACCESS_TOKEN` | For geocoding | Team-owned Mapbox token used with permanent Geocoding v6. |
| `PORT` | No | Listening port, default `3000`. |
| `HOST` | No | Listening host, default `127.0.0.1`; use `0.0.0.0` for a hosted instance. |

Configuration is loaded through `@nestjs/config` and validated when Nest creates the application. Keep `.env`, credentials, tokens, call transcripts, and personal test data out of version control.

## Commands

```sh
npm run dev          # watch TypeScript source; restarts clear the in-memory login
npm run build        # compile strict TypeScript into dist/
npm start            # run the compiled application with .env
npm run start:prod   # production alias for the compiled application
npm run lint         # lint source and tests
npm test             # unit and HTTP compatibility tests with mocked providers
npm run test:build   # compile, then run all tests
```

Run `npm run build` before `npm start`. Use the compiled process for demonstrations so a source edit does not clear the session.

## Architecture

```text
src/
├── main.ts                    # production entry point
├── bootstrap.ts               # Express adapter, body limit, validation, filters, timeouts
├── app.module.ts              # application composition
├── inbound/                   # HTTP entry points and trip-flow orchestration
├── auth/                      # Auth0 PKCE, callback, token lifecycle
├── mapbox/                    # geocoding controller, service, and provider client
├── mobie/                     # ride controllers, validation, service, and provider client
├── string-processing/         # inbound trip normalization and validation
├── config/                    # typed and validated environment configuration
└── common/                    # reusable guards, filters, middleware, HTTP client, runtime tokens
public/                        # browser login and latest Mobie response view
test/                          # unit and endpoint compatibility tests
```

- **Inbound** owns public HTTP entry points, static content, security headers, and the final 404 route.
- **Auth** owns OAuth2 Authorization Code + PKCE, state/cookie binding, code exchange, in-memory tokens, serialized rotation, login status, and logout.
- **Mapbox** validates location queries, encapsulates Geocoding v6, safely narrows untrusted responses, and maps candidates without treating Mapbox feature IDs as mobie IDs.
- **Mobie** validates ride payloads, obtains the current user access token, and encapsulates `/me`, search, detail, and join requests.
- **String processing** trims and validates Fonio's trip strings and converts its numeric seat string before any provider call. More advanced fuzzy matching can be added at this boundary.
- **Common** contains only cross-cutting concerns: constant-time API-key checks, the `{ "error": "..." }` exception boundary, security headers, and the timeout-limited upstream JSON client.

Controllers deal only with transport concerns. Services enforce application rules. External calls live in clients/providers and return `unknown` until checked at the trust boundary. Dependencies use explicit Nest injection tokens, which keeps provider calls replaceable in tests.

## Public and protected endpoints

No global prefix is used.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/` | Public | Browser login page |
| GET | `/page.js` | Public | Browser login script |
| GET | `/health` | Public | Process health only |
| GET | `/callback` | Public, state/cookie validated | Auth0 callback and redirect |
| POST | `/auth/login` | Team Bearer key | Start Auth0 PKCE login |
| POST | `/api/logout` | Team Bearer key | Clear in-memory credentials |
| GET | `/api/status` | Team Bearer key | Login state and access-token expiry, never tokens |
| GET | `/api/me` | Team Bearer key + login | Proxy mobie `/me` |
| POST | `/api/addresses/receive` | Team Bearer key | Store a spoken-address receipt without Mapbox or mobie login |
| GET | `/api/addresses/received` | Team Bearer key | Return the newest 20 in-memory address receipts |
| POST | `/api/trips/search` | Team Bearer key + login | Normalize inbound trip strings, resolve both locations and search Mobie |
| GET | `/api/trips/latest` | Team Bearer key | Return the latest completed flow for the browser |
| POST | `/api/locations/search` | Team Bearer key | Resolve an Austrian address with Mapbox |
| POST | `/api/rides/search` | Team Bearer key + login | Search rides using resolved locations |
| POST | `/api/rides/:id/join-detailed` | Team Bearer key + login + `confirmed: true` | Submit one booking request after consent |
| GET | `/api/rides/:id/rider-detail` | Team Bearer key + login | Approved-passenger detail |
| GET | `/api/rides/:id` | Team Bearer key + login | Driver-only detail |

Send `Authorization: Bearer <STARTER_API_KEY>` to every protected starter endpoint. The starter obtains and adds a separate Auth0 user access token when it calls mobie. It never returns OAuth tokens to the caller.

JSON request bodies must use `Content-Type: application/json` and are limited to 16 KiB. Errors use `{ "error": "description" }`. Provider response bodies are never relayed in errors because they can contain secrets. Writes are not automatically retried: after a timeout, verify the booking state before trying again.

See [docs/api.md](docs/api.md) for complete request/response contracts, [docs/authentication.md](docs/authentication.md) for the login lifecycle, [docs/challenge.md](docs/challenge.md) for the challenge, and [docs/postman_collection.json](docs/postman_collection.json) for Postman.

## First real search

Copy `examples/search.json`, replace its time and coordinates with a future staging example, then run:

```sh
npm run example:search -- ./my-search.json
```

The example searches only and never books. An empty array is a successful search with no matching ride.

## Adding modules and integrations

For a new inbound capability, add a focused Nest module with a thin controller and service, import it from `AppModule`, and mark only intentionally unauthenticated handlers with `@Public()`. Protected routes inherit the global API-key guard. Use DTO classes and `class-validator` at request boundaries.

For a provider integration, keep credentials in validated configuration, place network details in a dedicated injectable client, reuse `UpstreamHttpClient` for the 15-second timeout and sanitized errors, treat parsed JSON as `unknown`, and narrow it before use. Add mocked unit and HTTP tests; automated tests must not require live credentials or create staging writes.

The complete inbound search flow lives at `POST /api/trips/search`. It accepts `departure`, `destination`, `time` and `seatsRequested` as strings from Fonio, normalizes them in `string-processing/`, resolves both addresses through Mapbox and passes the selected coordinates to Mobie. More advanced street-name matching and ambiguity handling can be added inside the same processing boundary.

## Operational limits

- One process stores one passenger session; there is no caller-to-user mapping or persistence.
- Multiple replicas would need shared token storage and refresh coordination.
- `/api/rides/:id` is driver-only; passengers use search results before booking and rider detail only after approval.
- Mapbox Geocoding v6 uses `permanent=true` because mobie may persist locations. Ensure your account and data license permit storage.
- Only staging is supported. This starter is not a production identity or booking gateway.
