# mobie starter package guide

The [mobie starter](../../README.md) runs a local Node server that connects the Fonio phone assistant to the mobie staging API and Mapbox. One running process acts as one signed-in staging passenger.

## Run locally

Node 22 or later is required. Run these commands from the repository root.

```powershell
npm start
```

Open `http://localhost:3000`, enter the `STARTER_API_KEY` from the ignored `.env`, sign in as the test passenger and check the API connection. Restarting the process clears the login.

Configure `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE` and `STARTER_API_KEY`. Mapbox lookup also needs `MAPBOX_ACCESS_TOKEN`. The verified audience is `https://api-staging.mobie.at` without a trailing slash. The local callback is `http://localhost:3000/callback`.

To make the local API reachable from Fonio, run `ngrok http 3000` in another terminal after completing ngrok setup. The browser callback can remain local. Add the team key as the Fonio API tool's Bearer credential.

## Main files

| File | Responsibility |
| --- | --- |
| [src/auth.js](../../src/auth.js) | Auth0 PKCE login and serialized rotating token refresh. |
| [src/config.js](../../src/config.js) | Environment configuration and validation. |
| [src/server.js](../../src/server.js) | Protected HTTP endpoints for assistant tools. |
| [src/mapbox.js](../../src/mapbox.js) | Address lookup and candidate coordinates. |
| [src/mobie.js](../../src/mobie.js) | Staging ride searches and confirmed booking requests. |

## Reference

- [API endpoints and payloads](../api.md)
- [Authentication and session behavior](../authentication.md)
- [Challenge requirements](../challenge.md)
- [Postman collection](../postman_collection.json)
- [Architecture slides](../architecture/mobie-architecture-slides.html)

## Validation and limits

Run `npm test` inside the package. Tests use controlled responses and do not establish live phone or staging readiness.

The starter has no caller-number identity matching or per-call state store. A booking request requires `confirmed: true` and remains pending until the driver approves it. The custom address matcher and Fonio integration are proposed additions. Fonio is selected, but account setup and live tool calls remain to be verified.
