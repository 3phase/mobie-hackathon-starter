# Fonio address lookup configuration

Configure an HTTP Request in the Fonio assistant to send one spoken address to the starter during the conversation. The starter returns Mapbox location candidates. This integration does not submit ride requests.

## Prerequisites

Run the starter with `npm start` and expose port 3000 using `ngrok http 3000`. Keep both processes running. Use the current public HTTPS origin from ngrok.

Generate the dashboard values from the repository root:

```powershell
node --env-file=.env scripts/fonio-config.js --lookup
```

The local `.local/fonio-address-lookup.json` contains the prepared values, including the current URL and team authorization header. This file is ignored by Git and is a copy reference for the dashboard, not a Fonio import format.

## Dashboard fields

Open the assistant, select **Webhooks**, then **Add new webhook** and **Add HTTP request**.

| Field | Value |
| --- | --- |
| Name | `mobie_resolve_location` |
| Run | During the conversation |
| Availability | Always |
| Method | POST |
| URL | `https://<current-ngrok-host>/api/locations/search` |

Use this condition in **When should the AI use this**:

> Wenn die anrufende Person einen Start- oder Zielort nennt, verwende dieses Werkzeug, um passende Orte zu finden. Suche Start und Ziel getrennt. Frage zuerst nach der Gemeinde oder Postleitzahl, wenn der Ort unklar ist. Verwende das Ergebnis, um die gewünschte Adresse zu bestätigen.

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
  "query": "{{spoken_address}}"
}
```

Define the custom variable `spoken_address` with type **String** and this description:

> Die von der anrufenden Person genannte Adresse mit Straße, Hausnummer, Gemeinde und Postleitzahl, soweit vorhanden. Übernimm die verstandene Schreibweise und korrigiere schwierige Namen nicht eigenständig. Erfinde keine fehlenden Angaben. Maximal 256 Zeichen. Nur eine Adresse pro Anfrage.

Set the execution sentence under **Advanced** to:

> Ich prüfe die Adresse kurz.

## Response behavior

The response contains `candidates`, with `publicName`, `addressLine`, `longitude` and `latitude`, plus attribution. Include these instructions in the assistant's behavior without removing its existing instructions:

> Lies den passenden Adresskandidaten zur Bestätigung vor. Bei mehreren plausiblen Treffern frage gezielt nach Gemeinde, Postleitzahl oder Hausnummer. Wenn kein passender Treffer vorhanden ist, frage nach einer Präzisierung. Verwende nur zurückgegebene Koordinaten. Diese Integration sucht Orte und bucht keine Fahrt.

A custom variable is an AI extraction from the conversation. Its description does not guarantee an untouched speech recognition transcript.

## First test

Say: “Ich möchte von Villagarten vier in Steyregg losfahren. Die Postleitzahl ist vier zwei zwei eins.”

Check that Fonio invokes the tool, the request's `query` contains the intended address, and the returned candidates include **Villagarten 4, 4221 Steyregg, Österreich**. Confirm the correct candidate aloud. Then test an ambiguous street name and verify that the assistant asks for clarification.

On 14 October 2026, a direct request through the public tunnel returned the expected Steyregg address and coordinates. Fonio dashboard configuration and the spoken test remain to be completed.

If the ngrok public URL changes, update the tool URL in Fonio. An HTTP 401 from the starter indicates an incorrect or missing team key. The address lookup itself does not require a mobie passenger login; later ride searches and booking requests do.

## Reference

- [Fonio HTTP Request guide](https://fonio.info/en/developers/http-request)
- [Starter package guide](mobie-hackathon-starter.md)
- [Starter API](../api.md)
