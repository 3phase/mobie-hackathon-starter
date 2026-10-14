# Austrian voice address resolution

Voice address discovery uses the public OpenPLZ API. Mapbox is deliberately reserved for the final conversion of a confirmed structured address into validated coordinates.

## Provider and pagination

The integration calls:

- `GET /at/Localities?postalCode=…` for postcode, municipality, and locality data.
- `GET /at/Localities?name=…` for bounded city searches when no postcode has been collected.
- `GET /at/Streets?postalCode=…` for the complete street pool of one postcode.

Every request explicitly sends `page=1&pageSize=50`. The client requires numeric `x-page`, `x-page-size`, `x-total-count`, and `x-total-pages` headers, checks their internal consistency and item counts, and fetches every remaining page with at most three requests in flight. A missing, failed, or inconsistent page fails the entire load. Transient HTTP/network failures receive the configured bounded retry count; incomplete results are never returned or cached.

OpenPLZ's prepared data is licensed under the [ODC Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Deployments that publicly use or redistribute a derived database should retain OpenPLZ attribution, review the ODbL notice/share-alike requirements, and document any additional source attribution that applies. The Austrian source data is published by Statistik Austria; see the [OpenPLZ data-source page](https://www.openplzapi.org/en/sources/).

## Shared cache

`PostcodeCacheService` stores fully loaded locality and street datasets in process memory. It is shared across calls, independent of the 45-minute call-session store, and never preloads nationwide data. Concurrent cold loads for the same postcode share one promise. Failed loads are removed from the in-flight map and are not cached. The bounded map uses least-recently-used ordering.

| Setting | Default | Purpose |
| --- | ---: | --- |
| `OPENPLZ_BASE_URL` | `https://openplzapi.org` | Provider base URL |
| `OPENPLZ_CACHE_TTL_MS` | `86400000` | Cache lifetime (24 hours) |
| `OPENPLZ_CACHE_MAX_ENTRIES` | `100` | Maximum cached postcodes |
| `OPENPLZ_TIMEOUT_MS` | `8000` | Timeout for one provider attempt |
| `OPENPLZ_RETRIES` | `2` | Retries after transient failures |

## Matching behavior

Postcode candidates are grouped by municipality key, so several localities in one municipality do not create false city ambiguity. Municipality, locality, district, and federal-province fields remain distinct internally. Provider keys are incorporated into deterministic candidate IDs.

Text normalization is case-insensitive and Unicode-aware. It normalizes whitespace, punctuation and hyphens; maps `ß` to `ss`; supports `ä/ae`, `ö/oe`, and `ü/ue` variants; and treats `str.`, `strasse`, and `straße` equivalently. `Vienna`, `Vienne`, and `Vien` are bounded aliases for `Wien`.

Street ranking combines normalized Levenshtein similarity (65%), trigram Dice similarity (25%), and token overlap (10%). Exact normalized matches score `1`; strong umlaut-equivalent variants score `0.97`. Candidates below `0.58` are discarded. A single candidate is returned only when the best score is at least `0.86` and exceeds the runner-up by at least `0.08`; otherwise up to five plausible candidates are returned. Scores are deterministic heuristic similarities, not calibrated probabilities. These thresholds should be tuned against real Fonio transcripts.

## Mapbox handoff

Postcode, city, and street search never call Mapbox. After Fonio selects a real OpenPLZ street and a house number is present, `/api/voice/addresses/confirm` submits `address_number`, canonical `street`, `postcode`, and canonical municipality as structured Mapbox Geocoding v6 fields. Coordinates are accepted only from an `address` feature whose postcode, street, and house number agree with the selected structure and whose component match codes do not report an unmatched required component. Street-level fallback coordinates are rejected. Ride search still requires both call-session addresses to be in the final confirmed state with coordinates.

Known limitations:

- OpenPLZ does not provide a house-number registry; Mapbox performs the final house-number check.
- City-only lookup is deliberately bounded to 250 locality records. Fonio is asked for a postcode when the scope is broader.
- The cache is per process and is lost on restart; this is intentional for the hackathon deployment.
- Similarity thresholds need calibration with production speech-to-text errors and regional street pronunciations.

## Manual flow

All examples require `Authorization: Bearer $STARTER_API_KEY` and `Content-Type: application/json`.

```bash
curl -X POST http://localhost:3000/api/voice/postcodes/search \
  -H "Authorization: Bearer $STARTER_API_KEY" -H 'Content-Type: application/json' \
  -d '{"sessionId":"manual-1","side":"origin","postcode":"1030"}'

curl -X POST http://localhost:3000/api/voice/cities/search \
  -H "Authorization: Bearer $STARTER_API_KEY" -H 'Content-Type: application/json' \
  -d '{"sessionId":"manual-1","side":"origin","city":"Vienna"}'

curl -X POST http://localhost:3000/api/voice/addresses/search \
  -H "Authorization: Bearer $STARTER_API_KEY" -H 'Content-Type: application/json' \
  -d '{"sessionId":"manual-1","side":"origin","street":"Landstrasser Hauptstrase","houseNumber":"12"}'

curl -X POST http://localhost:3000/api/voice/addresses/confirm \
  -H "Authorization: Bearer $STARTER_API_KEY" -H 'Content-Type: application/json' \
  -d '{"sessionId":"manual-1","side":"origin","candidateId":"ID_FROM_SEARCH"}'
```

Use `/api/voice/cities/confirm` in the same way when a city lookup returns multiple candidates. An unambiguous postcode or high-confidence city can be applied automatically, in which case no city candidate ID is returned.
