# Fonio complete-flow configuration

Configure one HTTP Request in the Fonio assistant to send a complete trip to the starter. The starter normalizes the strings, resolves both locations through Mapbox and returns the best-ranked Mobie suggestion in a stable Fonio response. This integration searches but does not submit booking requests.

## Prerequisites

Run the starter with `npm start` and expose port 3000 using `ngrok http 3000`. Keep both processes running. Use the current public HTTPS origin from ngrok.

Generate the dashboard values from the repository root:

```powershell
node --env-file=.env scripts/fonio-config.js
```

The local `.local/fonio-trip-search.json` contains the prepared complete-flow values, including the current URL and team authorization header. This file is ignored by Git and is a copy reference for the dashboard, not a Fonio import format.

## Dashboard fields

Open the assistant, select **Webhooks**, then **Add new webhook** and **Add HTTP request**.

| Field | Value |
| --- | --- |
| Name | `mobie_search_rides` |
| Run | During the conversation |
| Availability | Always |
| Method | POST |
| URL | `https://<current-ngrok-host>/api/trips/search` |

Use this condition in **When should the AI use this**:

> Wenn Start, Ziel, Reisedatum, Uhrzeit und Sitzplatzanzahl vollständig und von der anrufenden Person bestätigt sind, suche mit diesem Werkzeug nach passenden Fahrten.

Headers, replacing the placeholder with the starter team key:

```json
{
  "Authorization": "Bearer <STARTER_API_KEY>",
  "Content-Type": "application/json"
}
```

Use the starter key here because Fonio is calling the starter. The Fonio API key does not authenticate requests to this endpoint.

Body:

```json
{
  "departure": "{{departure}}",
  "destination": "{{destination}}",
  "time": "{{time}}",
  "seatsRequested": "{{seats_requested}}"
}
```

Define these custom variables as strings:

- `departure`: confirmed start address with street, house number, postcode and municipality.
- `destination`: confirmed destination address with street, house number, postcode and municipality.
- `time`: confirmed ISO-8601 datetime. A timezone-less value from Fonio is interpreted in `Europe/Vienna`.
- `seats_requested`: confirmed integer from 1 to 8.

Set the execution sentence under **Advanced** to:

> Ich suche jetzt nach passenden Fahrten.

## Response behavior

The response has this shape. When Mobie returns no valid suggestion, `status` is `no_ride_found` and `rideDetails` is omitted, while the caller's normalized trip metadata remains present:

```json
{
  "status": "ride_found",
  "rideDetails": {
    "rideId": "ride-example",
    "driverName": "Alex",
    "pickupTimeIsEstimated": true
  },
  "pickupAddress": "Villagarten 4, 4221 Steyregg",
  "destinationAddress": "Bethlehemstraße, Linz",
  "pickupTime": "2026-10-20T15:05:00+02:00",
  "message": "Ich habe eine passende Fahrt mit Alex gefunden. ..."
}
```

The first item in Mobie's ranked array supplies `rideDetails`. `pickupEta` is used for `pickupTime` when present, converted to the `Europe/Vienna` offset, and `pickupTimeIsEstimated` is then `true`. Otherwise the requested time is retained and the flag is `false`. Include these instructions in the assistant's behavior without removing its existing instructions:

> Nutze das optionale Feld `message` als Antwort an die anrufende Person. `rideDetails` enthält die beste gefundene Fahrt; ohne `rideDetails` wurde keine passende Fahrt gefunden. Frage vor einer Buchungsanfrage immer ausdrücklich nach Bestätigung.

A custom variable is an AI extraction from the conversation. Its description does not guarantee an untouched speech recognition transcript.

## First test

Say: “Ich möchte am 19. Oktober 2026 um 15 Uhr mit einem Sitzplatz von Villagarten vier, 4221 Steyregg, zur Bethlehemstraße in 4020 Linz fahren.”

Check that Fonio invokes the tool with all four fields and that the response contains the normalized trip metadata plus `rideDetails` for the best-ranked match. Open the starter frontend and click **Refresh ride-search response** to inspect the same Fonio response.

If the ngrok public URL changes, update the tool URL in Fonio. An HTTP 401 from the starter indicates an incorrect team key or missing Mobie passenger login.

## Reference

- [Fonio HTTP Request guide](https://fonio.info/en/developers/http-request)
- [Starter package guide](mobie-hackathon-starter.md)
- [Starter API](../api.md)
