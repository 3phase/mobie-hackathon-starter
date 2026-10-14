# Fonio guided booking: overview, assistant setup and API reference

Status: **proposed contract, not implemented**. Updated 14 October 2026.

This design uses explicit departure/destination variables in Fonio. Requests carry their required context; there is no session-creation endpoint, `sessionId` or `addressRole` field. The existing `POST /api/addresses/receive-trip` remains a separate receipt-only test.

- [1. Overview](#1-overview)
- [2. Fonio setup: general prompt and shared settings](#2-fonio-setup-general-prompt-and-shared-settings)
- [3. Fonio setup: individual webhooks](#3-fonio-setup-individual-webhooks)
- [4. API reference and acceptance checks](#4-api-reference-and-acceptance-checks)
- [5. Caller usability assessment](#5-caller-usability-assessment)

## 1. Overview

### 1.1 Fonio to our app

```mermaid
sequenceDiagram
    actor Caller
    participant Fonio as Fonio dev call and voice assistant
    participant App as Our app
    Fonio-->>Caller: Brief introduction as the digital mobie assistant
    Note over Caller,Fonio: Retain all volunteered address and travel details. Ask only for missing information
    loop Start using from tools, then destination using destination tools
        opt Neither postcode nor city supplied and postcode not already declared unknown
            Fonio-->>Caller: Do you know the postcode for this address?
            Caller->>Fonio: Postcode or I do not know it
        end
        opt A postcode was supplied
            Fonio->>App: POST /api/voice/postcodes/search with supplied postcode
            App-->>Fonio: Accepted postcode or clarification
            Note over Caller,App: Do not silently discard conflicting input. Clarify it or explicitly use the unknown-postcode path
        end
        opt City not already supplied
            Fonio-->>Caller: In which city or municipality is this address?
            Caller->>Fonio: City or municipality
        end
        Fonio->>App: POST /api/voice/cities/search with city input and postcode if known
        App-->>Fonio: Accepted city or up to three options with short spoken labels
        opt Two or three city options
            Fonio-->>Caller: Short Option A, B and C if present
            Note over Caller,Fonio: Repeat a requested option without a new search or changing its letter
            Caller->>Fonio: Choose a city option by letter or unambiguous description
            Fonio->>App: POST /api/voice/cities/confirm with query context and chosen candidateToken
            App-->>Fonio: Accepted city and postcode if determinable
        end
        Note over Caller,App: Zero matches or unclear selection repeat the affected step without advancing
        Note over Fonio: Copy accepted city. Do not require a postcode if it is still unknown
        opt Street or house number not already supplied
            Fonio-->>Caller: Ask only for the missing street or house number
            Caller->>Fonio: Missing information
        end
        Fonio->>App: POST /api/voice/addresses/search with city, street, number and optional postcode
        App-->>Fonio: Accepted full address and coordinates, or up to three short options
        opt Two or three address options
            Fonio-->>Caller: Short Option A, B and C if present
            Caller->>Fonio: Choose or ask to repeat an option
            Note over Fonio: On repeat, read only the requested option and wait for a choice
            Fonio->>App: POST /api/voice/addresses/confirm after clear choice with original context and token
            App-->>Fonio: Accepted full address and coordinates
        end
        Note over Fonio: Retain accepted canonical values. A unique match needs no confirmation question
    end
    opt Any travel requirement still missing
        Fonio-->>Caller: For which date, time and how many passengers? Ask only for missing parts
        Caller->>Fonio: Date, time and passenger count, or a partial answer
        Note over Caller,Fonio: Retain supplied values and follow up only for missing or unclear parts
    end
    Fonio->>App: POST /api/voice/rides/search with both resolved addresses, time and count
    alt One to three rides found
        App-->>Fonio: Ride proposals with short labels, full summaries and proposalToken
        opt Two or three rides
            Fonio-->>Caller: A/B/C with distinguishing pickup time or location
            Caller->>Fonio: Choose a ride or ask for an option to be repeated
            Note over Fonio: Repeat requested option if needed and obtain an unambiguous choice
        end
        Fonio-->>Caller: Full passenger trip, actual pickup, driver, count and price. Ask booking consent
        Caller->>Fonio: Consent, refusal or correction
        alt Caller corrects trip details
            Note over Fonio,App: No join call. Clear dependent accepted values and consent, retain other raw inputs, revalidate and search again
            Fonio-->>Caller: Acknowledge the correction and ask only if information is missing or ambiguous
        else Clear consent or refusal
            Fonio->>App: POST /ride/join with full current trip, proposalToken and answer
            alt Explicit consent
                App-->>Fonio: booking_pending
                Fonio-->>Caller: Request sent and awaiting driver approval
            else Declined
                App-->>Fonio: declined with no booking submitted
            end
        end
        Note over Caller,Fonio: Unclear booking answer means ask again, never submit yet
    else No ride found
        App-->>Fonio: no_rides
        Fonio-->>Caller: Explain no match and ask whether to change the request
    end
```

Only valid inputs or accepted options advance. Technical failures and clarification responses never advance. A booking timeout has an unknown outcome and must not trigger an automatic retry.

### 1.2 Conversation rules

| Step | Rule |
| --- | --- |
| Postcode, when known | Validate and retain directly without confirmation. If unknown, continue with city-first lookup. Clarify a supplied conflicting/invalid postcode rather than silently ignoring it. |
| City, then street and house number | One eligible option advances automatically. Two or three are read as A/B/C and the caller chooses, with no extra yes/no question. Zero options require clarification. |
| Passenger count | Collect a clear integer from 1 to 8 and use it directly as seatsRequested. No confirmation or default guess. |
| Travel requirements | Ask date, time and passenger count together in one concise question, omitting any parts already known. Follow up only for missing or unclear values. |
| Ride | One ride needs no choice question. For two or three, read short distinguishing A/B/C labels and obtain a choice. Always read the full passenger trip and selected ride before separate booking consent, allowing corrections. |
| Booking | Submit only after explicit consent to the current trip and proposal. A stored request awaits driver approval in the staging app. |

Start and destination are validated in that order, but details volunteered for either side are retained immediately. Ask only for missing or conflicting fields, not for information already supplied. “Accepted” includes a validated input, automatic unique match or explicit option choice; it does not mean the caller answered a yes/no question. Address existence, intended location and ride availability remain different kinds of evidence.

### Supported shortcuts and clarification

- If the caller gives a full address, retain all its raw fields. Validate them in dependency order without asking the same questions again. When city/street are already supplied, do not interrupt to ask for an optional missing postcode; use city-first lookup. Do the same for volunteered date/time/count and for destination details given before the start is complete.
- Postcode is optional. If unknown, search the supplied city first and use it to resolve street/house number. Ask for region or another distinguishing detail only when city lookup is ambiguous. Do not infer a unique postcode from a city that spans several codes.
- For one match, advance automatically, but always include the complete passenger start/destination in the selected ride's read-back before booking consent. Corrections restart affected validation and ride search, not the whole conversation.
- Multiple options have short `spokenLabel` values. “Repeat B”, the place name or an unambiguous pickup-time description are valid conversational inputs. A repeat does not select, confirm, book, change letter assignments or trigger a new search.

### 1.3 Where the information lives

Fonio retains explicit values such as `from_postcode`, `from_city`, `from_street`, `from_house_number`, their destination equivalents, `travel_time` and `passenger_count`. Raw input variables are separate from canonical values returned by our app. Coordinates and candidate/proposal tokens are copied exactly from responses.

Each address request contains exactly one `from` or `destination` object. This replaces a generic addressRole field. The URL and populated object identify the operation; a request containing both objects on an address endpoint is invalid. Ride search and booking confirmation require both objects.

The app must not rely on a global “current caller” or “current trip”. It validates the context supplied with each request. This approach can also isolate concurrent callers as long as Fonio keeps each conversation's variables separate. Session IDs could later help tracing or persistent conversations, but are not required for this contract.

The address/search workflow is **stateless in our app**. Fonio holds the conversation values and sends all required known information on every request. Our app does not retain caller context, address-search records or a current trip between requests.

For selection integrity, this draft uses self-contained, server-signed `candidateToken` and `proposalToken` values. A candidate token carries the original query/context, selected canonical candidate and expiry; a proposal token carries the proposed ride, full passenger trip, passenger identity and expiry. Fonio copies them unchanged. Our app verifies their signature and supplied context without looking up a stored record. These are not session IDs. Signing is proposed development; tokens are integrity-protected, not assumed encrypted, and must not contain unnecessary personal information.

The existing server's Auth0 passenger login still lives in memory; stateless address processing does not remove that authentication requirement. Real ride requests are stored in mobie, as required by the challenge.

### 1.4 Requests build on known information

Each request is self-contained. The app never assumes that it remembers a previous request. Fonio supplies canonical values already returned by the app, plus the caller's new input.

| Request | Information Fonio sends |
| --- | --- |
| Postcode validation | The new postcode input. |
| City search | City input and accepted postcode when known; postcode is optional. |
| City selection, if multiple | The same city query and optional postcode context, plus the chosen signed candidate token and answer. |
| Street/house-number search | Accepted city, street and house-number input, plus postcode if known. |
| Address selection, if multiple | The same city/street/number and optional-postcode context plus the chosen signed candidate token and answer. |
| Ride search | Both full accepted addresses with returned coordinates, travel time and passenger count. |
| Booking consent | The full current trip again, the chosen signed proposal token and explicit consent/refusal. |

For example, start-city search:

```json
{
  "from": { "postcode": "4221", "city": "Steyregg" }
}
```

The next start-address search includes that known context:

```json
{
  "from": {
    "postcode": "4221",
    "city": "Steyregg",
    "street": "Villagarten",
    "houseNumber": "4"
  }
}
```

With an unknown postcode, city-first search uses the same route and an empty optional field:

```json
{
  "from": { "postcode": "", "city": "Steyregg" }
}
```

Once the city is accepted, address search can still proceed without a postcode:

```json
{
  "from": {
    "postcode": "",
    "city": "Steyregg",
    "street": "Villagarten",
    "houseNumber": "4"
  }
}
```

Destination requests work the same way under `destination`. Context fields are explicit data points, not a reference to a saved address. Return canonical values to Fonio for the next request; missing fields require clarification instead of loading hidden state.

### 1.5 Integration inventory

There are **seven app routes** and **twelve Fonio HTTP Request tools**. The five address operations each have a start and destination tool, with specific variable mappings. Both tools use the same route but different object keys. This avoids an addressRole parameter or a generic variable that Fonio must switch between addresses.

| App route | Fonio tools |
| --- | --- |
| `/api/voice/postcodes/search` | `mobie_search_from_postcode`, `mobie_search_destination_postcode` |
| `/api/voice/cities/search` | `mobie_search_from_city`, `mobie_search_destination_city` |
| `/api/voice/cities/confirm` | `mobie_select_from_city`, `mobie_select_destination_city` |
| `/api/voice/addresses/search` | `mobie_search_from_address`, `mobie_search_destination_address` |
| `/api/voice/addresses/confirm` | `mobie_select_from_address`, `mobie_select_destination_address` |
| `/api/voice/rides/search` | `mobie_search_ride` |
| `/ride/join` | `mobie_confirm_booking` |

Our app implements these orchestration routes using the processor and geographic/mobie adapters. Mapbox does not expose these custom routes. They are not live yet.

## 2. Fonio setup: general prompt and shared settings

### 2.1 General assistant prompt

Paste into the assistant's main prompt. If using a separate greeting field, avoid speaking the greeting twice.

```text
Du hilfst bei mobie, eine Mitfahrgelegenheit zu finden. Sprich Deutsch und stelle jeweils eine klare Frage.
Begrüße einmal kurz: „Hallo, ich bin der digitale mobie-Assistent. Ich helfe dir, eine passende Mitfahrgelegenheit zu finden.“
Frage nach der Postleitzahl des Startorts nur, wenn weder Postleitzahl noch Stadt genannt wurde und die Person nicht bereits gesagt hat, dass die Postleitzahl unbekannt ist. Wenn die Stadt oder vollständige Adresse schon vorliegt, suche ohne erneute Frage nach einer optionalen Postleitzahl. Der Testanruf startet in Fonios Entwicklungsoberfläche; kein Sitzungsstart-Werkzeug.

Erfasse alle bereits genannten Angaben für Start, Ziel, Datum, Uhrzeit und Personenzahl sofort. Frage niemals erneut nach klaren vorhandenen Angaben.
Validiere zuerst den Start, danach das Ziel: bekannte Postleitzahl, dann Stadt/Gemeinde, dann Straße und Hausnummer. Auch bei vollständig genannter Adresse validierst du im Hintergrund, ohne die Angaben nochmals abzufragen.
Verwende dafür die Werkzeuge mit from im Namen. Wiederhole den Ablauf für das Ziel mit destination im Namen.
Halte Start- und Zielvariablen strikt getrennt. Es gibt keine sessionId und keine addressRole im Request.
Sende in jedem Werkzeug die bereits übernommenen Kontextwerte gemäß dessen Body mit.
Übernimm kanonische Werte und Koordinaten exakt aus App-Antworten. Erfinde keine Namen, Hausnummern, Koordinaten oder Tokens.
Nach jeder erfolgreichen Antwort mit status accepted kopiere die Felder aus accepted.from in die gleichnamigen from-Variablen und aus accepted.destination in die destination-Variablen.
Beispiel: accepted.from.city wird from_city, accepted.from.houseNumber wird from_house_number, accepted.from.longitude wird from_longitude.
Verwende für die nächste Suche die übernommenen Werte unserer App, nicht die ursprüngliche Schreibweise aus den _input-Variablen.
Die _input-Variablen bleiben nur für neue Suchtexte und den ursprünglichen Kontext einer Optionsauswahl erhalten.
Bei needs_selection oder needs_clarification darfst du noch keine ungeklärten Kandidaten als übernommene Werte speichern.
Fehlen erforderliche Antwortfelder, halte den Ablauf an und kläre das Problem. Ergänze sie nicht aus Vermutungen oder alten Werten.

Postleitzahl: wenn bekannt direkt prüfen und übernehmen, keine Bestätigungsfrage. Wenn unbekannt, sage „Kein Problem, in welcher Stadt liegt die Adresse?“ und suche die Stadt ohne Postleitzahl. Wurde die Stadt schon genannt, suche direkt ohne neue Frage. Verwende für eine unbekannte Postleitzahl einen leeren String, niemals eine erfundene Zahl. Eine widersprüchliche genannte Postleitzahl nicht stillschweigend verwerfen, sondern klären.
Stadt oder vollständige Adresse: Bei genau einer Option übernimmt die App sie automatisch. Speichere die Werte und gehe ohne Bestätigungsfrage weiter.
Bei zwei oder drei Optionen lies „Option A: …, Option B: …, Option C: …“ mit den kurzen spokenLabel-Werten vor. Nenne zuerst nur unterscheidende Orts-, Abholzeit- oder Abholpunktangaben, nicht lange vollständige Beschreibungen.
Bei „B wiederholen“ lies nur Option B erneut vor. Suche nicht neu und ändere die Buchstaben nicht. Akzeptiere auch eine eindeutige Orts- oder Zeitbeschreibung statt des Buchstabens. Bei unklarer Zuordnung frage nach.
Frage nach der Auswahl. Sende die eindeutige Wahl mit dem passenden Stadt-/Adress-Auswahlwerkzeug, ohne zusätzliche Ja/Nein-Frage.
Bei unklarer Wahl frage erneut. Wähle niemals automatisch die erste von mehreren Optionen.
Bei needs_clarification frage die zurückgegebene Frage und wiederhole die betroffene Suche. Technische Fehler sind keine leeren Suchergebnisse.

Wenn beide Adressen übernommen sind, frage Datum, Uhrzeit und Personenzahl gemeinsam: „Für welchen Tag, welche Uhrzeit und wie viele Personen suchst du eine Fahrt?“
Lasse bereits bekannte Angaben aus der Frage weg. Übernimm alle Teile der Antwort und frage nur nach noch fehlenden oder unklaren Teilen, z. B. „Für wie viele Personen?“.
Übernimm eine klare gültige Anzahl von 1 bis 8 direkt, ohne Bestätigungsfrage. Rate nicht, wenn sie fehlt.
Suche mit beiden vollständigen Adressen, Reisezeitpunkt und Anzahl eine Fahrt.
Bei mehreren Fahrten lies A/B/C und frage nach der gewünschten Fahrt. Bei einer Fahrt überspringe die Auswahlfrage.
Lies vor jeder Buchungsfrage den vollständigen Fahrgast-Start und das vollständige Fahrgast-Ziel mit Gemeinde und bekannter Postleitzahl, Datum, tatsächlichem Abholort, Abholzeit, verfügbaren Fahrerinformationen, Plätzen und Preisangaben vor. Das gilt auch, wenn eindeutige Adressen zuvor ohne Bestätigung übernommen wurden. Erlaube jederzeit eine Korrektur.
Erkläre fehlende Angaben als unbekannt. Frage immer gesondert: „Soll ich für diese Fahrt eine Buchungsanfrage senden?“
booking_confirmed ist nur nach ausdrücklicher Zustimmung zur aktuellen vorgelesenen Fahrt true. Adressübernahme und Fahrtauswahl sind keine Buchungszustimmung.
Bei Ablehnung darf keine Buchung gesendet werden. Bei unklarer Antwort erneut fragen.
Bei booking_pending sage, dass die Anfrage auf Fahrerbestätigung wartet. Bei booking_outcome_unknown nicht automatisch erneut senden.

Bei Korrekturen lösche abhängige kanonische Werte, Koordinaten, Kandidaten und Fahrtvorschläge, bevor du neu suchst. Bewahre andere bereits genannte Rohangaben zur erneuten Validierung auf und frage sie nicht unnötig erneut ab.
Korrigierte Postleitzahl: Stadt und vollständige Adresse neu validieren. Korrigierte Stadt: Straße und vollständige Adresse neu validieren. Bei geänderter Hausnummer nur die vollständige Adresse neu prüfen. Bestätige die konkrete Änderung kurz.
Eine Korrektur während der Buchungsfrage ist keine Buchungszustimmung: nicht join aufrufen, erst neu validieren, Fahrten neu suchen, vollständige Zusammenfassung erneut vorlesen und erneut um Buchungszustimmung bitten.
Jede Änderung an Adresse, Zeit oder Personenzahl löscht selected_proposal_token und bisherige Buchungszustimmung.
Verwende ausschließlich Tokens der aktuellen passenden Antwort. Behaupte bei Fehlern keinen sicheren Erfolg.

```

### 2.2 Shared webhook settings

Start calls manually from Fonio's dev interface. No start-session webhook is needed. Configure the following tools only after the proposed backend routes work; for an immediate transport test, use [the two-address receiver](../packages/fonio-trip-receipt.md).

In the assistant, open **Webhooks → Add new webhook → Add HTTP request**. Use these defaults for all twelve tools:

| Setting | Value |
| --- | --- |
| Run | During the conversation |
| Availability | Always for the test assistant |
| Method | POST |
| URL | The individual template below, replacing APP_ORIGIN with our public HTTPS origin, without a trailing slash |
| Headers | Copy the JSON below exactly; it contains our dev starter token |
| Body and custom variables | Copy from the individual webhook section |
| Advanced / execution sentence | Einen Moment, ich prüfe deine Angaben. |

```json
{
  "Authorization": "Bearer 21TzmJn6aGyd3THqOIo0fsivI3liS1xpe5ADr_fyqdU",
  "Content-Type": "application/json"
}
```

For booking use the neutral execution sentence `Ich verarbeite deine Antwort.` because the answer can be a refusal. The header above contains the dev starter token for these integrations and can be pasted as written. It is the token for our app, not the Fonio API key.

Copy each trigger into **When should the AI use this?**. Response rules belong in the general prompt; use a separate response-instructions field too if available. Disable older competing receipt/lookup tools on this guided test assistant.

Boolean and numeric placeholders are unquoted. Verify that variable substitution produces valid JSON, including quotation marks and umlauts. Use Fonio's variable picker where available. The [official HTTP Request guide](https://fonio.info/en/developers/http-request) documents these settings. It does not establish automatic extraction of response fields into custom variables: test that Fonio copies canonical values, coordinates and tokens correctly between tools. Do not assume an unsupported JSON-import or response-mapping feature.

### 2.3 Updating and clearing variables

Store raw caller input in the relevant `_input` variable. Store app-returned canonical values separately. For an accepted response, copy every field of `accepted.from` or `accepted.destination` into the matching variables. A selected option's token must come from the current candidate list. The letters A/B/C are spoken labels, not tokens.

- Postcode correction clears that side's accepted city/address values, coordinates and candidate references. Retain unchanged raw city/street/number input for revalidation; do not ask the caller to repeat it unless needed.
- City correction clears that side's accepted street/address values, coordinates and candidate references. Retain unchanged raw street/number input for revalidation.
- Street/house-number correction clears that side's accepted full address, coordinates and address candidate reference. Retain postcode/city context when still valid and revalidate using the corrected raw field.
- Any address, time or passenger-count change clears ride proposals, selected_proposal_token and booking consent.
- Never reuse another conversation's values or use empty coordinates. Ask only for missing required context. An unknown postcode is optional, not a reason to ask it repeatedly.

### 2.4 Exact response-to-next-request mapping

**This is a required behavior to configure and verify, not a claim that Fonio performs automatic variable assignment.** The guided tools have not been implemented or tested live. A prompt and a variable description alone do not prove that the actual next HTTP request contains the returned values.

After `status: "accepted"`, copy canonical fields from the response as follows. Preserve their types. Only fields present in that step's accepted response are updated; fields invalidated by a correction remain empty until resolved again. For an unknown postcode initialise the relevant canonical postcode variable to an empty string. An accepted city/address response returns postcode as a canonical value when known or as an empty string when unknown; never reuse a postcode from an invalidated address.

| App response field | Fonio variable | Used in subsequent requests |
| --- | --- | --- |
| `accepted.from.postcode` | `from_postcode` | Start city search/selection, start address search/selection, ride search and booking |
| `accepted.from.city` | `from_city` | Start address search/selection, ride search and booking |
| `accepted.from.street` | `from_street` | Ride search and booking |
| `accepted.from.houseNumber` | `from_house_number` | Ride search and booking |
| `accepted.from.publicName` | `from_public_name` | Ride search and booking |
| `accepted.from.addressLine` | `from_address_line` | Ride search and booking |
| `accepted.from.longitude` | `from_longitude` (Number) | Ride search and booking |
| `accepted.from.latitude` | `from_latitude` (Number) | Ride search and booking |
| `accepted.destination.postcode` | `destination_postcode` | Destination city search/selection, destination address search/selection, ride search and booking |
| `accepted.destination.city` | `destination_city` | Destination address search/selection, ride search and booking |
| `accepted.destination.street` | `destination_street` | Ride search and booking |
| `accepted.destination.houseNumber` | `destination_house_number` | Ride search and booking |
| `accepted.destination.publicName` | `destination_public_name` | Ride search and booking |
| `accepted.destination.addressLine` | `destination_address_line` | Ride search and booking |
| `accepted.destination.longitude` | `destination_longitude` (Number) | Ride search and booking |
| `accepted.destination.latitude` | `destination_latitude` (Number) | Ride search and booking |

For multiple options, the chosen `candidates[n].candidateToken` is copied to the matching `from_city_candidate_token`, `from_address_candidate_token`, `destination_city_candidate_token` or `destination_address_candidate_token`. Send it with the original search input through the matching selection tool. Copy canonical values only from that tool's subsequent accepted response. For a unique option, the search response itself contains accepted values; no selection call is needed.

The chosen `proposals[n].proposalToken` is copied to `selected_proposal_token`. Copying or choosing that token does **not** set `booking_confirmed`; that boolean comes only from the caller's answer to the separate booking question. Keep `travel_time` and `passenger_count` as the caller's collected requirements unless the caller changes them.

Example: Fonio initially sends a city input such as `Stei regg`, but the app returns this illustrative accepted response:

```json
{
  "status": "accepted",
  "message": "Wie lauten Straße und Hausnummer?",
  "accepted": { "from": { "postcode": "4221", "city": "Steyregg" } },
  "selectionMethod": "automatic"
}
```

The next street/house-number request must contain the returned city spelling:

```json
{
  "from": {
    "postcode": "4221",
    "city": "Steyregg",
    "street": "Villagarten",
    "houseNumber": "4"
  }
}
```

Here postcode/city come from the prior app response. Street/house number are the caller's new input. Sending `Stei regg` again as the city context fails this contract, even if Fonio pronounced the correct name aloud.

## 3. Fonio setup: individual webhooks

Each section uses the shared method, timing, authorization and execution sentence above. Start tools and destination tools deliberately use different variables. Search never substitutes the other side's values.

### 3.1 Start — Postcode

| Fonio field | Value |
| --- | --- |
| Name | `mobie_search_from_postcode` |
| URL | `<APP_ORIGIN>/api/voice/postcodes/search` |
| When should the AI use this? | Nur wenn die Start-Postleitzahl genannt oder korrigiert wurde. Wenn unbekannt, dieses Werkzeug überspringen und mit der Stadt fortfahren. Keine Bestätigungsfrage. |

**Body**

```json
{
  "from": {
    "postcode": "{{from_postcode_input}}"
  }
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `from_postcode_input` | String | Genannte Start-Postleitzahl. Verstandene Ziffernfolge übernehmen, keine andere Postleitzahl erfinden. |

**Response handling:** Valid supplied postcode: retain it in Fonio, then ask for city only if not already supplied; otherwise search the city directly. If the supplied postcode conflicts or is invalid, clarify it. If the caller does not know it, use the city-first path instead of repeatedly requesting a postcode. No A/B/C postcode selection or confirmation.

### 3.2 Start — City

| Fonio field | Value |
| --- | --- |
| Name | `mobie_search_from_city` |
| URL | `<APP_ORIGIN>/api/voice/cities/search` |
| When should the AI use this? | Wenn für Start die Stadt genannt oder korrigiert wurde. Bekannte geprüfte Postleitzahl mitsenden, sonst leeren String. Bereits genannte Stadt nicht erneut abfragen. |

**Body**

```json
{
  "from": {
    "postcode": "{{from_postcode}}",
    "city": "{{from_city_input}}"
  }
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `from_postcode` | String | Geprüfte Start-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `from_city_input` | String | Genannte oder korrigierte Start-Gemeinde, so wie verstanden. |

**Response handling:** One eligible option: retain accepted values in Fonio and continue, without confirmation. Two or three: read short A/B/C spoken labels and obtain a choice; repeat only the requested option on demand without searching again. Zero: ask for clarification and repeat this search. Do not advance on error.

### 3.3 Start — City selection

| Fonio field | Value |
| --- | --- |
| Name | `mobie_select_from_city` |
| URL | `<APP_ORIGIN>/api/voice/cities/confirm` |
| When should the AI use this? | Nur nach eindeutiger Auswahl einer von mehreren aktuellen Start-Optionen A/B/C. Bei genau einer Option nicht verwenden. |

**Body**

```json
{
  "from": {
    "postcode": "{{from_postcode}}",
    "city": "{{from_city_input}}"
  },
  "candidateToken": "{{from_city_candidate_token}}",
  "confirmed": {{selection_confirmed}},
  "reply": "{{selection_reply}}"
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `from_postcode` | String | Geprüfte Start-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `from_city_input` | String | Genannte oder korrigierte Start-Gemeinde, so wie verstanden. |
| `from_city_candidate_token` | String | candidateToken der gewählten aktuellen Start-Stadtoption. Exakt aus der App-Antwort kopieren, nicht den Buchstaben A/B/C senden. |
| `selection_confirmed` | Boolean | true bei eindeutiger Wahl einer aktuellen Stadt-/Adressoption, false bei Ablehnung eines bestimmten Kandidaten. Bei Unklarheit erneut fragen. Keine Buchungszustimmung. |
| `selection_reply` | String | Die verstandene Antwort zur aktuellen Stadt-/Adressauswahl, z. B. Option B. |

**Response handling:** Send the selected candidate token and original search context. The choice needs no further yes/no question. Retain returned accepted values in Fonio. Reject stale or mismatched references. If all options are rejected, collect corrected input and repeat search without inventing a token.

### 3.4 Start — Street and house number

| Fonio field | Value |
| --- | --- |
| Name | `mobie_search_from_address` |
| URL | `<APP_ORIGIN>/api/voice/addresses/search` |
| When should the AI use this? | Wenn für Start die Gemeinde übernommen wurde und Straße sowie Hausnummer vorliegen. Bekannte Postleitzahl mitsenden, sonst leeren String. Bereits genannte Straße/Hausnummer direkt verwenden. |

**Body**

```json
{
  "from": {
    "postcode": "{{from_postcode}}",
    "city": "{{from_city}}",
    "street": "{{from_street_input}}",
    "houseNumber": "{{from_house_number_input}}"
  }
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `from_postcode` | String | Geprüfte Start-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `from_city` | String | Übernommene Start-Gemeinde exakt aus unserer App-Antwort übernehmen. |
| `from_street_input` | String | Genannter Start-Straßenname, so wie verstanden. Nicht selbst korrigieren. |
| `from_house_number_input` | String | Genannte Start-Hausnummer einschließlich Zusatz wie 4a. Nicht erfinden. |

**Response handling:** One eligible option: retain accepted values in Fonio and continue, without confirmation. Two or three: read short A/B/C spoken labels and obtain a choice; repeat only the requested option on demand without searching again. Zero: ask for clarification and repeat this search. Do not advance on error.

### 3.5 Start — Address selection

| Fonio field | Value |
| --- | --- |
| Name | `mobie_select_from_address` |
| URL | `<APP_ORIGIN>/api/voice/addresses/confirm` |
| When should the AI use this? | Nur nach eindeutiger Auswahl einer von mehreren aktuellen Start-Optionen A/B/C. Bei genau einer Option nicht verwenden. |

**Body**

```json
{
  "from": {
    "postcode": "{{from_postcode}}",
    "city": "{{from_city}}",
    "street": "{{from_street_input}}",
    "houseNumber": "{{from_house_number_input}}"
  },
  "candidateToken": "{{from_address_candidate_token}}",
  "confirmed": {{selection_confirmed}},
  "reply": "{{selection_reply}}"
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `from_postcode` | String | Geprüfte Start-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `from_city` | String | Übernommene Start-Gemeinde exakt aus unserer App-Antwort übernehmen. |
| `from_street_input` | String | Genannter Start-Straßenname, so wie verstanden. Nicht selbst korrigieren. |
| `from_house_number_input` | String | Genannte Start-Hausnummer einschließlich Zusatz wie 4a. Nicht erfinden. |
| `from_address_candidate_token` | String | candidateToken der gewählten aktuellen vollständigen Start-Adressoption. Exakt aus der App-Antwort kopieren. |
| `selection_confirmed` | Boolean | true bei eindeutiger Wahl einer aktuellen Stadt-/Adressoption, false bei Ablehnung eines bestimmten Kandidaten. Bei Unklarheit erneut fragen. Keine Buchungszustimmung. |
| `selection_reply` | String | Die verstandene Antwort zur aktuellen Stadt-/Adressauswahl, z. B. Option B. |

**Response handling:** Send the selected candidate token and original search context. The choice needs no further yes/no question. Retain returned accepted values in Fonio. Reject stale or mismatched references. If all options are rejected, collect corrected input and repeat search without inventing a token.

### 3.6 Ziel — Postcode

| Fonio field | Value |
| --- | --- |
| Name | `mobie_search_destination_postcode` |
| URL | `<APP_ORIGIN>/api/voice/postcodes/search` |
| When should the AI use this? | Nur wenn die Ziel-Postleitzahl genannt oder korrigiert wurde. Wenn unbekannt, dieses Werkzeug überspringen und mit der Stadt fortfahren. Keine Bestätigungsfrage. |

**Body**

```json
{
  "destination": {
    "postcode": "{{destination_postcode_input}}"
  }
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `destination_postcode_input` | String | Genannte Ziel-Postleitzahl. Verstandene Ziffernfolge übernehmen, keine andere Postleitzahl erfinden. |

**Response handling:** Valid supplied postcode: retain it in Fonio, then ask for city only if not already supplied; otherwise search the city directly. If the supplied postcode conflicts or is invalid, clarify it. If the caller does not know it, use the city-first path instead of repeatedly requesting a postcode. No A/B/C postcode selection or confirmation.

### 3.7 Ziel — City

| Fonio field | Value |
| --- | --- |
| Name | `mobie_search_destination_city` |
| URL | `<APP_ORIGIN>/api/voice/cities/search` |
| When should the AI use this? | Wenn für Ziel die Stadt genannt oder korrigiert wurde. Bekannte geprüfte Postleitzahl mitsenden, sonst leeren String. Bereits genannte Stadt nicht erneut abfragen. |

**Body**

```json
{
  "destination": {
    "postcode": "{{destination_postcode}}",
    "city": "{{destination_city_input}}"
  }
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `destination_postcode` | String | Geprüfte Ziel-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `destination_city_input` | String | Genannte oder korrigierte Ziel-Gemeinde, so wie verstanden. |

**Response handling:** One eligible option: retain accepted values in Fonio and continue, without confirmation. Two or three: read short A/B/C spoken labels and obtain a choice; repeat only the requested option on demand without searching again. Zero: ask for clarification and repeat this search. Do not advance on error.

### 3.8 Ziel — City selection

| Fonio field | Value |
| --- | --- |
| Name | `mobie_select_destination_city` |
| URL | `<APP_ORIGIN>/api/voice/cities/confirm` |
| When should the AI use this? | Nur nach eindeutiger Auswahl einer von mehreren aktuellen Ziel-Optionen A/B/C. Bei genau einer Option nicht verwenden. |

**Body**

```json
{
  "destination": {
    "postcode": "{{destination_postcode}}",
    "city": "{{destination_city_input}}"
  },
  "candidateToken": "{{destination_city_candidate_token}}",
  "confirmed": {{selection_confirmed}},
  "reply": "{{selection_reply}}"
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `destination_postcode` | String | Geprüfte Ziel-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `destination_city_input` | String | Genannte oder korrigierte Ziel-Gemeinde, so wie verstanden. |
| `destination_city_candidate_token` | String | candidateToken der gewählten aktuellen Ziel-Stadtoption. Exakt aus der App-Antwort kopieren, nicht den Buchstaben A/B/C senden. |
| `selection_confirmed` | Boolean | true bei eindeutiger Wahl einer aktuellen Stadt-/Adressoption, false bei Ablehnung eines bestimmten Kandidaten. Bei Unklarheit erneut fragen. Keine Buchungszustimmung. |
| `selection_reply` | String | Die verstandene Antwort zur aktuellen Stadt-/Adressauswahl, z. B. Option B. |

**Response handling:** Send the selected candidate token and original search context. The choice needs no further yes/no question. Retain returned accepted values in Fonio. Reject stale or mismatched references. If all options are rejected, collect corrected input and repeat search without inventing a token.

### 3.9 Ziel — Street and house number

| Fonio field | Value |
| --- | --- |
| Name | `mobie_search_destination_address` |
| URL | `<APP_ORIGIN>/api/voice/addresses/search` |
| When should the AI use this? | Wenn für Ziel die Gemeinde übernommen wurde und Straße sowie Hausnummer vorliegen. Bekannte Postleitzahl mitsenden, sonst leeren String. Bereits genannte Straße/Hausnummer direkt verwenden. |

**Body**

```json
{
  "destination": {
    "postcode": "{{destination_postcode}}",
    "city": "{{destination_city}}",
    "street": "{{destination_street_input}}",
    "houseNumber": "{{destination_house_number_input}}"
  }
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `destination_postcode` | String | Geprüfte Ziel-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `destination_city` | String | Übernommene Ziel-Gemeinde exakt aus unserer App-Antwort übernehmen. |
| `destination_street_input` | String | Genannter Ziel-Straßenname, so wie verstanden. Nicht selbst korrigieren. |
| `destination_house_number_input` | String | Genannte Ziel-Hausnummer einschließlich Zusatz wie 4a. Nicht erfinden. |

**Response handling:** One eligible option: retain accepted values in Fonio and continue, without confirmation. Two or three: read short A/B/C spoken labels and obtain a choice; repeat only the requested option on demand without searching again. Zero: ask for clarification and repeat this search. Do not advance on error.

### 3.10 Ziel — Address selection

| Fonio field | Value |
| --- | --- |
| Name | `mobie_select_destination_address` |
| URL | `<APP_ORIGIN>/api/voice/addresses/confirm` |
| When should the AI use this? | Nur nach eindeutiger Auswahl einer von mehreren aktuellen Ziel-Optionen A/B/C. Bei genau einer Option nicht verwenden. |

**Body**

```json
{
  "destination": {
    "postcode": "{{destination_postcode}}",
    "city": "{{destination_city}}",
    "street": "{{destination_street_input}}",
    "houseNumber": "{{destination_house_number_input}}"
  },
  "candidateToken": "{{destination_address_candidate_token}}",
  "confirmed": {{selection_confirmed}},
  "reply": "{{selection_reply}}"
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `destination_postcode` | String | Geprüfte Ziel-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `destination_city` | String | Übernommene Ziel-Gemeinde exakt aus unserer App-Antwort übernehmen. |
| `destination_street_input` | String | Genannter Ziel-Straßenname, so wie verstanden. Nicht selbst korrigieren. |
| `destination_house_number_input` | String | Genannte Ziel-Hausnummer einschließlich Zusatz wie 4a. Nicht erfinden. |
| `destination_address_candidate_token` | String | candidateToken der gewählten aktuellen vollständigen Ziel-Adressoption. Exakt aus der App-Antwort kopieren. |
| `selection_confirmed` | Boolean | true bei eindeutiger Wahl einer aktuellen Stadt-/Adressoption, false bei Ablehnung eines bestimmten Kandidaten. Bei Unklarheit erneut fragen. Keine Buchungszustimmung. |
| `selection_reply` | String | Die verstandene Antwort zur aktuellen Stadt-/Adressauswahl, z. B. Option B. |

**Response handling:** Send the selected candidate token and original search context. The choice needs no further yes/no question. Retain returned accepted values in Fonio. Reject stale or mismatched references. If all options are rejected, collect corrected input and repeat search without inventing a token.

### 3.11 Ride search

| Fonio field | Value |
| --- | --- |
| Name | `mobie_search_ride` |
| URL | `<APP_ORIGIN>/api/voice/rides/search` |
| When should the AI use this? | Wenn beide vollständigen Adressen mit App-Koordinaten, Reisezeitpunkt und Personenzahl vorliegen. |

**Body**

```json
{
  "from": {
    "postcode": "{{from_postcode}}",
    "city": "{{from_city}}",
    "street": "{{from_street}}",
    "houseNumber": "{{from_house_number}}",
    "publicName": "{{from_public_name}}",
    "addressLine": "{{from_address_line}}",
    "longitude": {{from_longitude}},
    "latitude": {{from_latitude}}
  },
  "destination": {
    "postcode": "{{destination_postcode}}",
    "city": "{{destination_city}}",
    "street": "{{destination_street}}",
    "houseNumber": "{{destination_house_number}}",
    "publicName": "{{destination_public_name}}",
    "addressLine": "{{destination_address_line}}",
    "longitude": {{destination_longitude}},
    "latitude": {{destination_latitude}}
  },
  "time": "{{travel_time}}",
  "seatsRequested": {{passenger_count}}
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `from_postcode` | String | Geprüfte Start-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `from_city` | String | Übernommene Start-Gemeinde exakt aus unserer App-Antwort übernehmen. |
| `from_street` | String | Übernommener Start-Straßenname aus der App-Antwort. |
| `from_house_number` | String | Übernommene Start-Hausnummer aus der App-Antwort. |
| `from_public_name` | String | publicName der übernommenen vollständigen Start-Adresse aus der App-Antwort. |
| `from_address_line` | String | addressLine der übernommenen vollständigen Start-Adresse aus der App-Antwort. |
| `from_longitude` | Number | longitude der übernommenen Start-Adresse exakt aus unserer App-Antwort. Keine Koordinaten erfinden. |
| `from_latitude` | Number | latitude der übernommenen Start-Adresse exakt aus unserer App-Antwort. Nicht mit longitude vertauschen. |
| `destination_postcode` | String | Geprüfte Ziel-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `destination_city` | String | Übernommene Ziel-Gemeinde exakt aus unserer App-Antwort übernehmen. |
| `destination_street` | String | Übernommener Ziel-Straßenname aus der App-Antwort. |
| `destination_house_number` | String | Übernommene Ziel-Hausnummer aus der App-Antwort. |
| `destination_public_name` | String | publicName der übernommenen vollständigen Ziel-Adresse aus der App-Antwort. |
| `destination_address_line` | String | addressLine der übernommenen vollständigen Ziel-Adresse aus der App-Antwort. |
| `destination_longitude` | Number | longitude der übernommenen Ziel-Adresse exakt aus unserer App-Antwort. Keine Koordinaten erfinden. |
| `destination_latitude` | Number | latitude der übernommenen Ziel-Adresse exakt aus unserer App-Antwort. Nicht mit longitude vertauschen. |
| `travel_time` | String | Gewünschter Reisezeitpunkt als ISO-8601 mit passendem UTC-Offset für Europe/Vienna am Reisedatum. Bei Unklarheit fragen. |
| `passenger_count` | Number | Gewünschte Anzahl der Mitfahrenden als ganze Zahl von 1 bis 8. Klare gültige Angabe direkt übernehmen, ohne Bestätigungsfrage. |

**Response handling:** Retain the returned proposals in Fonio. One ride: read it and ask booking consent. Two or three: read short distinguishing A/B/C labels, support repeating one option, then read the complete chosen passenger trip and ride before separate booking consent. No rides: explain and offer a change.

### 3.12 Booking consent

| Fonio field | Value |
| --- | --- |
| Name | `mobie_confirm_booking` |
| URL | `<APP_ORIGIN>/ride/join` |
| When should the AI use this? | Nach der ausdrücklichen Antwort auf die Buchungsfrage zur aktuellen vollständig vorgelesenen Fahrt. Unklare Antworten zuerst klären. |

**Body**

```json
{
  "from": {
    "postcode": "{{from_postcode}}",
    "city": "{{from_city}}",
    "street": "{{from_street}}",
    "houseNumber": "{{from_house_number}}",
    "publicName": "{{from_public_name}}",
    "addressLine": "{{from_address_line}}",
    "longitude": {{from_longitude}},
    "latitude": {{from_latitude}}
  },
  "destination": {
    "postcode": "{{destination_postcode}}",
    "city": "{{destination_city}}",
    "street": "{{destination_street}}",
    "houseNumber": "{{destination_house_number}}",
    "publicName": "{{destination_public_name}}",
    "addressLine": "{{destination_address_line}}",
    "longitude": {{destination_longitude}},
    "latitude": {{destination_latitude}}
  },
  "time": "{{travel_time}}",
  "seatsRequested": {{passenger_count}},
  "proposalToken": "{{selected_proposal_token}}",
  "confirmed": {{booking_confirmed}},
  "reply": "{{booking_reply}}"
}
```

**Custom variables**

| Variable | Type | Description to enter in Fonio |
| --- | --- | --- |
| `from_postcode` | String | Geprüfte Start-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `from_city` | String | Übernommene Start-Gemeinde exakt aus unserer App-Antwort übernehmen. |
| `from_street` | String | Übernommener Start-Straßenname aus der App-Antwort. |
| `from_house_number` | String | Übernommene Start-Hausnummer aus der App-Antwort. |
| `from_public_name` | String | publicName der übernommenen vollständigen Start-Adresse aus der App-Antwort. |
| `from_address_line` | String | addressLine der übernommenen vollständigen Start-Adresse aus der App-Antwort. |
| `from_longitude` | Number | longitude der übernommenen Start-Adresse exakt aus unserer App-Antwort. Keine Koordinaten erfinden. |
| `from_latitude` | Number | latitude der übernommenen Start-Adresse exakt aus unserer App-Antwort. Nicht mit longitude vertauschen. |
| `destination_postcode` | String | Geprüfte Ziel-Postleitzahl aus der App-Antwort, wenn bekannt. Bei unbekannter Postleitzahl leerer String; nicht erfinden oder erneut erzwingen. |
| `destination_city` | String | Übernommene Ziel-Gemeinde exakt aus unserer App-Antwort übernehmen. |
| `destination_street` | String | Übernommener Ziel-Straßenname aus der App-Antwort. |
| `destination_house_number` | String | Übernommene Ziel-Hausnummer aus der App-Antwort. |
| `destination_public_name` | String | publicName der übernommenen vollständigen Ziel-Adresse aus der App-Antwort. |
| `destination_address_line` | String | addressLine der übernommenen vollständigen Ziel-Adresse aus der App-Antwort. |
| `destination_longitude` | Number | longitude der übernommenen Ziel-Adresse exakt aus unserer App-Antwort. Keine Koordinaten erfinden. |
| `destination_latitude` | Number | latitude der übernommenen Ziel-Adresse exakt aus unserer App-Antwort. Nicht mit longitude vertauschen. |
| `travel_time` | String | Gewünschter Reisezeitpunkt als ISO-8601 mit passendem UTC-Offset für Europe/Vienna am Reisedatum. Bei Unklarheit fragen. |
| `passenger_count` | Number | Gewünschte Anzahl der Mitfahrenden als ganze Zahl von 1 bis 8. Klare gültige Angabe direkt übernehmen, ohne Bestätigungsfrage. |
| `selected_proposal_token` | String | proposalToken der gerade ausgewählten und vollständig vorgelesenen Fahrt. Exakt aus der aktuellen App-Antwort kopieren. |
| `booking_confirmed` | Boolean | true ausschließlich nach ausdrücklicher Buchungszustimmung zur vollständig vorgelesenen aktuellen Fahrt. false bei Ablehnung. A/B/C-Auswahl allein genügt nicht. |
| `booking_reply` | String | Die verstandene Antwort auf die gesonderte Buchungsfrage. |

**Response handling:** Verify the signed proposal against the full current trip. true makes one submission attempt for this HTTP request; false returns refusal and submits nothing. A repeated HTTP request is not guaranteed deduplicated. booking_pending means awaiting driver approval. booking_outcome_unknown must not trigger an automatic retry.

## 4. API reference and acceptance checks

### 4.1 Request context and identity

Every request requires the starter key. Address endpoints accept exactly one populated `from` or `destination` object and use only its supplied fields. There is no backend current-address selector or evolving caller session. A response contains the same object key, so Fonio knows which specific variables to update.

The canonical `from` and `destination` shapes for ride search contain postcode, city, street, houseNumber, publicName, addressLine, longitude and latitude, as shown in the webhook bodies. Input postcode/houseNumber fields are strings. Coordinates are numeric and copied from geographic results. `seatsRequested` is the passenger count, an integer from 1 to 8. `time` is an ISO-8601 timestamp with an explicit offset or Z; resolve relative words using Europe/Vienna and the actual date. Do not silently default missing travel requirements.

**Optional-postcode rule:** city search/selection, address search/selection, ride search and join accept `postcode` omitted or as `""` when unknown. Existing Fonio body templates use an empty string for this case; the backend normalises omission and empty string identically before token comparison. Postcode validation itself requires a supplied input and is skipped when unknown. The caller must supply a city for city-first lookup; a known city plus street/number can resolve the final address without asking the caller for a postcode. The provider may later supply a postcode, which Fonio copies from the accepted response. Do not erase a conflicting supplied postcode silently.

Verify that Fonio actually sends an empty string for this optional value in the multi-step test. If its configuration cannot represent that, use a supported optional-field mapping or an explicit city-first body omitting postcode; do not fabricate a value. Coordinates, labels, time and passenger count remain required at ride search/join.

The app forwards the resolved passenger coordinates, labels, time and seats to the existing mobie adapter. One running starter still uses one Auth0 passenger account. Multiple callers can have separate request context but would still book as that same account; individual caller-to-account identity is outside this demo. A session ID alone would not solve authentication or authorisation.

### 4.2 Response shape and options

Successful conversational responses use HTTP 200 and include `status` and a short German `message`. Clarification, selection, no_rides and declined are conversational outcomes, not HTTP errors. Technical/validation errors use the HTTP statuses and error envelope in section 4.4. `accepted` contains validated canonical fields when the step has succeeded. With a single eligible city/address candidate, the app returns it in `accepted` immediately. Multiple candidates return a list for selection and do not populate accepted values prematurely.

Postcode example:

```json
{
  "status": "accepted",
  "message": "In welcher Stadt oder Gemeinde möchtest du losfahren?",
  "accepted": { "from": { "postcode": "4221" } },
  "selectionMethod": "direct_input"
}
```

Illustrative city search with two fictional candidates:

```json
{
  "status": "needs_selection",
  "message": "Option A: Musterstadt Nord. Option B: Musterstadt Süd. Welche Option meinst du?",
  "candidates": [
    { "option": "A", "candidateToken": "candidate-example-a", "label": "Musterstadt Nord", "spokenLabel": "Musterstadt Nord", "city": "Musterstadt Nord" },
    { "option": "B", "candidateToken": "candidate-example-b", "label": "Musterstadt Süd", "spokenLabel": "Musterstadt Süd", "city": "Musterstadt Süd" }
  ],
  "hasMore": false
}
```

The candidate references bind the original search input, its side (`from` or `destination`) and geographic context. Confirmation sends that same context, candidateToken and the caller's choice. The app verifies the self-contained token signature, context, completeness and expiry, then returns canonical values under `accepted`. It does not load a saved candidate record. No searchId or sessionId is required. The client must discard old references on corrections; without a caller-state store the app cannot know that another search happened, so it validates context/expiry rather than claiming to enforce a global “latest search”.

An accepted city returns the canonical city and postcode if uniquely determinable, otherwise `postcode: ""`. A city may cover several postcodes; this does not require a postcode-choice question when city and later street/number can resolve the location. An accepted complete address returns canonical city/street/number, labels and coordinates, plus postcode when the provider supplies it, otherwise an empty string. Missing optional postcode alone must not block resolution. Missing required precision, coordinates or conflicting components require clarification rather than invented values. Unique matches use `selectionMethod: "automatic"`; caller choices use `selectionMethod: "caller_choice"`. Neither proves intended-location correctness.

City/address search returns at most three deduplicated eligible `candidates`. Ride search returns at most three `proposals`. The app assigns A/B/C in returned order and sets `hasMore` when more eligible options were omitted. Each candidate/proposal also includes a short `spokenLabel` containing the distinguishing information; full fields remain available for the final summary. Repeat commands use the same list and tokens, not a new search. Do not suppress plausible alternatives just to force automatic advancement. Postcode is direct validation, not an options list. Zero city/address matches require clarification; zero rides means no_rides. A technical failure is neither.

| Status | Action |
| --- | --- |
| `accepted` | Store returned canonical values and proceed to the next question for the tool just used. |
| `needs_clarification` | Ask the returned question and repeat the affected input/search. |
| `needs_selection` | City/address only: read A/B/C, validate the choice through the selection tool and retain the returned values in Fonio. |
| `ride_proposed` | Select if multiple, read the chosen or sole ride and ask separate booking consent. |
| `no_rides` | Explain and offer to change the request. |
| `declined` | No booking submitted. |
| `booking_pending` | Request stored; awaiting driver approval. |
| `booking_outcome_unknown` | Submission may have succeeded; check before any retry. |

Responses omit nextStep; Fonio follows the documented dependency order rather than a server-maintained conversation state: start city/context → complete address → destination city/context → complete address → travel requirements → ride → booking consent. Validate supplied postcodes before using them, but skip postcode tools when unknown. Validation calls still run for volunteered fields; questions are asked only for missing or conflicting information. Clarifications repeat their step; corrections revalidate affected context and clear dependent accepted values without discarding other raw input.

### 4.3 Selection and booking boundaries

City/address `/confirm` routes validate an option choice and return the accepted canonical values; they do not store that choice. `confirmed: true` means an unambiguous A/B/C choice, without another yes/no question. false can reject a specific candidate. If all options are rejected, ask for corrected input and search again. Never fabricate a token or infer consent from silence.

Ride search requires both complete accepted locations, time and passenger count. Each proposal contains a proposalToken and the ride summary: rideId, passenger start/destination, actual pickup location/time when available, available driver details, seats and price/payment information. The driver route's start/time may differ from passenger pickup. Do not invent missing details or describe unknown prices as free. Convert cents correctly. The ranking rule is still to be defined.

For multiple rides, an A/B/C answer selects a proposal but does not book it. Read the selected trip and ask “Soll ich für diese Fahrt eine Buchungsanfrage senden?” even when there is only one ride. The booking tool sends the **full current trip** plus proposalToken and the answer. The app verifies the signed proposal token and compares its embedded trip, expiry and passenger identity with the supplied current trip and signed-in passenger before submitting. No saved proposal record is required. A changed address, time or count requires another search; it must not book the old proposal.

**Stateless booking limitation:** a signed proposal token does not make a write single-use. With no submission store, the app cannot guarantee deduplication or detect replay of an already-used token. Fonio must send consent once and must not retry automatically. If the response is lost or times out, report an unknown outcome and check mobie staging before any retry. The mobie endpoint is not assumed idempotent; its duplicate-request rejection is not a general exactly-once guarantee. Reliable retry/replay prevention would require backend-supported idempotency or a deliberately introduced submission record, which is deferred rather than claimed here. A successful response remains pending until driver approval.

### 4.4 Limits and failures

- Proposed raw address-field limit: 256 characters each. Keep the existing JSON body limit of 16 KiB.
- Reject missing context, invalid coordinates, malformed or invalidly signed candidate/proposal tokens, mismatched input context and expired references. Never use another request's mutable state to fill gaps.
- Proposed token lifetime: 15 minutes; refreshed searches return fresh signed tokens. Exact lifetime, signing-secret configuration and rotation need implementation. Verification uses server configuration, not a per-call store.
- Proposed HTTP errors: 400 invalid input/context, 401 missing starter key/passenger login, 409 mismatched or conflicting proposal, 410 expired reference, 413 oversized body, 415 wrong content type, 502 provider failure, 503 unavailable configuration. Malformed or invalidly signed tokens are 400.
- Proposed guided-route errors use `{ "error": { "code": "...", "message": "..." } }` with a short German message. Existing technical routes still use their current string-error format.
- Distinguish an invalid request shape/type or missing required context (HTTP 400) from a well-formed postcode/city/address query that cannot be resolved (`needs_clarification`, HTTP 200). Fonio asks for missing caller input before calling a tool, and can use a validation-error message to request a corrected value without advancing.
- City-first lookup with unknown postcode is now part of this proposed contract and requires implementation. Postcode/city data coverage and missing-house-number/landmark support remain open implementation decisions. None of the guided paths is live yet.
- Signed tokens and explicit request context isolate data, but caller identity, persistent conversations, call tracing and richer session management are separate future concerns. Do not store unnecessary caller personal data.

### 4.5 Acceptance checks

1. No proposed request/response depends on sessionId, addressRole or a global current trip. All twelve Fonio tools map explicit variables to the seven app routes.
2. Start values never overwrite destination values. Parallel requests using different inputs do not share mutable address state.
3. Clear valid supplied postcode and passenger count need no confirmation. Unknown postcode proceeds through city-first lookup, without a postcode tool call. Missing/unclear required city, address or passenger information asks for clarification.
4. One city/address option advances automatically. Two or three use short A/B/C spoken labels and retain the exact chosen values after app validation, without another yes/no question. A repeat request preserves labels/tokens and triggers no new search. Zero options do not advance.
5. The app enforces the three-option cap and accurate hasMore values. Candidate identity is distinct from the spoken option letter.
6. App-returned canonical fields, coordinates and tokens survive real Fonio tool-to-tool calls exactly using section 2.4's mapping. Missing values and invalid JSON substitution are caught.
7. City/address selection verifies token signature, original query, its side, geographic context and expiry without a server-side candidate record. Corrections clear dependent Fonio variables and old references.
8. Ride search includes both resolved locations, explicit time and passenger count; a valid address does not prove caller intent or ride availability.
9. A sole ride still requires booking consent. Multiple rides require choice and then separate booking consent. Refusal or unclear consent never submits.
10. The booking request includes full current trip context, not just proposalToken. Context changes, expiry or passenger changes prevent reuse.
11. Fonio does not duplicate submissions or blindly retry unknown write outcomes. Test that the documented stateless limit is explicit: repeated identical HTTP writes cannot be guaranteed deduplicated. A successful request is pending and is verified/approved in the separate driver's app.
12. A full address volunteered early does not trigger repeated questions for its known fields. Unknown postcode is not a hard stop. Validate all supplied context before using canonical fields.
13. The complete passenger trip, actual pickup, date/time, passenger count, available driver and price information are read before every booking consent question, including automatically accepted addresses. A correction invalidates prior consent and re-runs affected lookup/ride search.
14. Date, time and passenger count are collected with one combined question when all are missing. Partial answers retain the known values and prompt only for missing or unclear parts; they do not restart all three questions.

### 4.6 Live response-chaining verification

Run this against controlled test responses first, once the guided endpoints or a test fixture are available. Inspect the **actual next HTTP request body** in Fonio's tool trace and at our receiving endpoint; correct spoken output alone is insufficient evidence. Do not include authorization headers or real keys in shared evidence.

1. Return a canonical city deliberately different from the spoken input, as in section 2.4. Verify that the next address request sends exactly that canonical city and the returned postcode.
2. Return canonical street/house-number values and distinct numeric coordinates. Verify that ride search sends exactly those returned values and numbers, rather than the original street input, rounded coordinates or invented values.
3. Repeat for destination with different values. Confirm that none of the start variables changes.
4. Return three options, choose B, and verify the selection request carries B's exact token plus the original query context. Verify the following request uses the accepted values returned by the selection response.
5. Return clarification, an error or a response missing a required field. Confirm that Fonio does not advance using an unaccepted candidate or stale value.
6. Return two rides, choose one and verify the selected proposal token. Confirm that no booking call is made with positive consent until the caller answers the separate booking question.

7. Run a city-first lookup with postcode omitted and with `""`; verify equivalent behaviour, successful address resolution and no request for a caller confirmation of postcode. If the app returns a postcode later, verify it is reused.
8. Volunteer a full start/destination address and travel requirements at the beginning. Verify retained inputs are validated without repeated questions and without bypassing required provider calls.
9. Ask “repeat B”. Verify only B is repeated, its token/letter stays unchanged, no search is called and no selection/booking is submitted.
10. Correct a house number during the final booking read-back. Verify no join occurs, other raw inputs are retained, affected coordinates/proposal/consent are cleared, and a new search and full read-back precede fresh consent.

Record the response/next-request pairs as the evidence for chaining. If Fonio cannot reliably retain and reuse these fields, the configuration must be changed to a supported deterministic mapping mechanism or the contract simplified; do not mark the flow verified based only on the prompt. This verification has **not yet been performed** for the guided tools.

### 4.7 Required development

Implement the seven guided routes, optional-postcode/city-first lookup, processor integration, explicit context validation, short spoken labels, bounded options and self-contained signed candidate/proposal tokens. Configure volunteered-field reuse, repeat-option handling and corrections before booking in Fonio. Do not introduce conversation, search or proposal storage. Keep robust booking idempotency as an explicit future decision; unknown booking outcomes are checked in staging before retry. No guided routes are implemented today; the existing NestJS Mapbox/mobie adapters and receipt receiver are the available building blocks.

Related: [architecture](../architecture/voice-ride-booking.md), [string processor scope](../architecture/voice-ride-booking.md#string-processor-scope-and-error-model), [existing API reference](../api.md), [working Fonio receipt setup](../packages/fonio-trip-receipt.md).

## 5. Caller usability assessment

Status: design review on 14 October 2026, **not a usability test with callers**. The findings are reasoned risks based on the documented flow. Completion time, recognition accuracy, satisfaction and abandonment have not been measured. The four approved improvements are now incorporated into the proposed contract, prompt, diagram and webhook rules: city-first fallback, volunteered-field reuse, complete final read-back with corrections, and short/repeatable A/B/C options. They have not been implemented or tested live. Other findings below remain recommendations.

### 5.1 Overall assessment

The flow is understandable for a cooperative caller who knows both full postal addresses. It is suitable as a controlled demo baseline. It is not yet a robust general phone service: unknown-postcode and volunteered-address paths are now specified but unverified, ordinary descriptions such as a station are outside the current contract, and repeated-failure recovery still needs a concrete policy.

Strengths are the brief introduction, a predictable start-then-destination order, no redundant confirmation for postcode/count or unique matches, at most three options, and a separate booking question. Saying that a request awaits driver approval also sets the right expectation.

With both addresses entered field by field, unique matches and date/time/count collected together, the documented baseline requires **8 caller answers**: six address answers, one combined travel-requirement answer and one booking answer. It makes **8 app requests**: six address searches/validations, one ride search and one join attempt. Four ambiguous city/address stages add four choice answers and four selection requests; multiple rides add another choice answer. This can become **13 caller answers and 12 app requests** before clarification of partial answers or other retries. These are counts for the fully prompted postcode-known path, not fixed costs or measured durations. With unknown postcodes the two postcode calls can be skipped, reducing the unique-match path to six app requests. Volunteered details skip their questions while keeping needed validation calls. These shortcuts have not been demonstrated live.

### 5.2 Findings from the caller's perspective

| Priority | Caller difficulty | Assessment and proposed improvement |
| --- | --- | --- |
| High | “I know the destination, but not its postcode.” | Addressed in the design: city-first search accepts an unknown postcode and street lookup may derive it. Implement and test ambiguous-city handling without forcing a postcode. |
| High | “I already gave you my full address.” | Addressed in the prompt: retain all volunteered fields, validate in order and ask only for missing/conflicting information. Verify actual variable retention before claiming this works. |
| High | “The assistant found the wrong real address.” | Addressed in the design: unique matches still advance automatically, but the complete passenger trip is read before booking consent and corrections trigger revalidation/new search. Wrong-but-real matches remain a test priority. |
| High | “No, only the house number changed.” | Clearing dependent variables is necessary, but the conversation should not restart unrelated questions. Retain raw context for revalidation, announce the specific correction and ask again only when ambiguity remains. Canonical values must not be reused until revalidated. |
| Medium | “I cannot remember all three options.” | Addressed in the design: short spokenLabel values, stable A/B/C choices, repeat-one-option support and unambiguous descriptive answers. Test recognition and retention without lengthy lists. |
| Medium | “Why do I keep hearing ‘one moment’?” | The baseline has seven app calls before booking. Repeating the same execution sentence at each step can make the flow feel slow. Measure tool latency and vary short, relevant acknowledgements; avoid unnecessary spoken filler while preserving useful wait feedback. |
| High | “You did not understand me twice. What now?” | The contract allows clarification but has no agreed limit, targeted spelling fallback, silence policy or usable exit. Define a recovery policy, including what happens when the task cannot be completed. Do not promise a human transfer unless staffed and implemented. |
| Medium | “Can I cancel, repeat or change the destination?” | Option repetition and targeted corrections are now specified. Whole-request cancellation and a complete failed-recovery exit still need definition and testing. |
| High | “Is the ride booked or am I still waiting?” | Pending wording is correct, but there is no implemented later voice notification. Explain where approval can be checked in the staging app; do not promise a callback or notification. |

These recommendations follow established guidance on one-question prompts and low-memory voice choices, applied here as design judgment. Sources: [Google conversation design: questions](https://developers.google.com/assistant/conversation-design/questions), [Google: confirmations](https://developers.google.com/assistant/conversation-design/confirmations), [W3C voice systems and conversational interfaces](https://www.w3.org/TR/coga-voice/). They do not establish Fonio-specific capabilities or prove this implementation usable.

### 5.3 Example wording to test

Use short progress cues that identify which address is being collected:

```text
Hallo, ich bin der digitale mobie-Assistent. Ich helfe dir, eine passende Mitfahrgelegenheit zu finden.
Kennst du die Postleitzahl deines Startorts?
[Wenn unbekannt:] Kein Problem, in welcher Stadt liegt die Adresse?
[Wenn noch nicht genannt:] Wie lauten Straße und Hausnummer?
Jetzt zum Ziel. [Frage nur nach dort noch fehlenden Angaben.]
```

Collect travel requirements in one question: “Für welchen Tag, welche Uhrzeit und wie viele Personen suchst du eine Fahrt?” If the caller says “Morgen um drei”, retain date/time, resolve any time ambiguity and ask only for the missing passenger count. When comparing rides, lead with useful differences such as pickup time and location; provide available driver/price details and the complete passenger trip in the selected ride's final read-back. Example with fictional names and a hypothetical free ride:

```text
Option A: Abholung um 15 Uhr, Fahrer Alex.
Option B: Abholung um 15:30 Uhr, Fahrerin Sam.
Welche Fahrt möchtest du?

Du möchtest am 19. Oktober um 15 Uhr mit einer Person von Villagarten 4 in Steyregg
zur Bethlehemstraße in Linz fahren. Die Abholung ist an [tatsächlicher Abholort]
um [tatsächliche Abholzeit], mit Alex. Diese Fahrt ist laut Angebot kostenlos.
Soll ich dafür eine Buchungsanfrage senden?
```

Fill these details only from actual returned trip/ride data. This example is not a staging ride record. Unknown pickup or price details must be explained rather than filled from the driver's route or guessed. After successful submission: “Deine Anfrage wurde gesendet. Alex muss sie noch bestätigen.”

### 5.4 Small usability test before expanding scope

Observe people making calls without coaching them through the tool sequence. Include clear addresses, a volunteered full address, an unknown postcode, a wrong-but-existing match, an A/B/C choice, a correction after ride search, no matching rides and refusal to book. Do not label demo fixtures as successful real bookings.

Record task completion, intended-location correctness, caller questions/answers, clarification turns, repeated questions, tool waits, successful corrections, abandonment and understanding of pending status. Ask the caller to explain which ride was requested and whether the driver has accepted it. Verify actual outbound payloads alongside the conversation; fluent speech alone does not establish correct data propagation.

Prioritise response-field propagation and the single-ride happy path first. Then test corrections, city-first lookup, volunteered-field reuse and option repetition. Define repeated-failure recovery and landmark support separately. Agree measurable targets after collecting a baseline rather than inventing performance scores from the written design.
