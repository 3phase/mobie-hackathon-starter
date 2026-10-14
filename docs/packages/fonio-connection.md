# Fonio complete-flow configuration

Configure one HTTP Request in the Fonio assistant to send a complete trip to the starter. The starter normalizes the strings, resolves both locations through Mapbox and returns the raw Mobie ride-search response. This integration searches but does not submit booking requests.

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
- `time`: confirmed ISO-8601 datetime with `Z` or an explicit offset.
- `seats_requested`: confirmed integer from 1 to 8.

Set the execution sentence under **Advanced** to:

> Ich suche jetzt nach passenden Fahrten.

## Response behavior

The response is Mobie's unmodified ride array. Include these instructions in the assistant's behavior without removing its existing instructions:

> Die Antwort ist die unveränderte Mobie-Fahrtenliste. Wenn sie leer ist, sage, dass keine passende Fahrt gefunden wurde. Fasse sonst die passenden Fahrten zusammen. Diese Integration bucht keine Fahrt.

A custom variable is an AI extraction from the conversation. Its description does not guarantee an untouched speech recognition transcript.

## First test

Say: “Ich möchte am 19. Oktober 2026 um 15 Uhr mit einem Sitzplatz von Villagarten vier, 4221 Steyregg, zur Bethlehemstraße in 4020 Linz fahren.”

Check that Fonio invokes the tool with all four fields and that the response is a Mobie ride array. Open the starter frontend and click **Refresh ride-search response** to inspect the same raw response.

If the ngrok public URL changes, update the tool URL in Fonio. An HTTP 401 from the starter indicates an incorrect team key or missing Mobie passenger login.

## Reference

- [Fonio HTTP Request guide](https://fonio.info/en/developers/http-request)
- [Starter package guide](mobie-hackathon-starter.md)
- [Starter API](../api.md)
