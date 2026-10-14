# Fonio address receipt test

This first test proves that Fonio can send an address string to our app. It does not use Mapbox, mobie login or ride booking.

## Fonio setup

Keep the existing HTTP Request name `mobie_resolve_location`, POST method, team authorization header and `spoken_address` String variable. Change the URL to the current ngrok HTTPS origin followed by `/api/addresses/receive`.

Body:

```json
{ "query": "{{spoken_address}}" }
```

Trigger:

```text
Sobald der Anrufer eine Adresse nennt, sende diese mit diesem Werkzeug an unsere App.
```

Execution sentence:

```text
Ich sende die Adresse kurz.
```

Use this prompt for the connection test:

```text
Du testest die Verbindung zu unserer App.
Frage den Anrufer nach einer Adresse.
Sobald er eine Adresse nennt, sende sie mit mobie_resolve_location.
Wenn die Antwort received: true enthält, sage:
„Danke, die Adresse ist in unserer App angekommen.“
Prüfe keine Adresse und suche oder buche keine Fahrt.
```

## Proof in our app

Open `http://localhost:3000`, enter the team key and click **Refresh received addresses**. A new timestamp and the text received from Fonio prove that the request reached the app. The latest 20 receipts live in server memory and clear on restart.

The authenticated `GET /api/addresses/received` endpoint returns the same receipt list. Each receipt has an ID, the unchanged `query` string and a UTC receipt timestamp. This proves text delivery, not verbatim speech recognition: Fonio extracts the variable from the conversation.

The POST response immediately returns HTTP 200 with `received: true`, the received address, receipt ID, timestamp and a German acknowledgement. Empty strings and strings over 256 characters return HTTP 400. Both endpoints require the starter team key.

## Generate the settings

With the app and ngrok running, execute from the repository root:

```powershell
node --env-file=.env scripts/fonio-config.js
```

The resulting ignored `.local/fonio-address-receive.json` contains the live URL and authorization header. To generate the later Mapbox lookup configuration, add `--lookup`.
