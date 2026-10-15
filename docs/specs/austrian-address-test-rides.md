# Five Austrian address test rides

Proposed fixtures for **mobie staging**, prepared on 14 October 2026. These rides have not been created in the backend. Store the correctly spelled addresses; introduce difficult pronunciation or transcription variants on the caller side.

The linked municipal and government sources verify the addresses, not Mapbox coverage or pickup suitability. Check the selected map pins when creating each ride.

## Rides to prepare

Dates are suggested future test dates. All departures are at **15:00 Europe/Vienna local time**, with **four available seats**. Change dates to suit the actual test and use the same date/time in the passenger request.

| ID | Date | Start | Destination |
| --- | --- | --- | --- |
| AT-01 | 2026-10-25 | [Weißenwolffstraße 3, 4221 Steyregg](https://www.oesterreich.gv.at/de/orgsearch/org/2401) | [Leopold-Schöffl-Platz 1, 4209 Engerwitzdorf](https://www.engerwitzdorf.gv.at/Web/Impressum) |
| AT-02 | 2026-10-26 | [Marktplatz 2, 4180 Zwettl an der Rodl](https://www.land-oberoesterreich.gv.at/Mediendateien/Formulare/Dokumente_BH_UU/Kundmachung_Marktgemeinde_Zwettl_Rodl_18.06.2024_13.00_Uhr.pdf) | [Marktplatz 1, 4202 Hellmonsödt](https://guide.oberoesterreich.at/oesterreich-poi/detail/105373/marktgemeinde-hellmonsoedt.html) |
| AT-03 | 2026-10-27 | [Burgstraße 3, 6091 Götzens](https://www.goetzens.gv.at/system/web/kontakt.aspx?menuonr=218742192) | [Sylvester-Jordan-Straße 12, 6094 Axams](https://www.axams.gv.at/Verwaltung/Gemeindeamt/Kontakt) |
| AT-04 | 2026-10-28 | [Marktstraße 17, 4201 Gramastetten](https://gramastetten.gem2go.at/) | [Kirchenstraße 1, 4048 Puchenau](https://www.puchenau.at/Politik_Verwaltung/Abteilungen) |
| AT-05 | 2026-10-29 | [Reichenauer Straße 1, 4210 Gallneukirchen](https://www.gallneukirchen.at/Stadtamt_1) | [Marktplatz 7, 4100 Ottensheim](https://ottensheim.gem2go.at/) |

## Spoken requests and transcription tests

The variants below are **synthetic test inputs**, not observed Fonio errors. First test a normal spoken request and record what Fonio actually transcribes. Then use controlled variants to test the string processor separately. The expected behavior describes acceptance targets, not a claim that matching is already implemented.

### AT-01 — Steyregg to Engerwitzdorf

**Why it is difficult:** unusual town spelling, double letters, umlauts and a compound personal-name street.

**Say:** “Ich möchte von der Weißenwolffstraße drei in Steyregg zum Leopold-Schöffl-Platz eins in Engerwitzdorf fahren.”

**Try these transcription variants:**

- `Steiregg` instead of `Steyregg`.
- `Weissenwolfstrasse` instead of `Weißenwolffstraße`.
- `Leopold Scheffl Platz` instead of `Leopold-Schöffl-Platz`.

**Expected behavior:** use postcode/town context to suggest real street candidates; clarify an uncertain changed name rather than silently substituting another place. Preserve house numbers 3 and 1.

### AT-02 — Zwettl an der Rodl to Hellmonsödt

**Why it is difficult:** unfamiliar town names, a multiword place name and the same street name at both ends. This tests both name matching and geographic context.

**Say:** “Vom Marktplatz zwei in Zwettl an der Rodl zum Marktplatz eins in Hellmonsödt, bitte.”

**Try these transcription variants:**

- `Zwettl an der Rodel` instead of `Zwettl an der Rodl`.
- `Zwetl` instead of `Zwettl`.
- `Hellmonsedt` instead of `Hellmonsödt`.

**Expected behavior:** keep the two towns and house numbers separate. If the caller only says “Zwettl”, ask for the missing geographic context when needed instead of assuming a municipality. A Marktplatz match alone is insufficient.

### AT-03 — Götzens to Axams

**Why it is difficult:** short unfamiliar town names, an umlaut and a long street name. This provides a Tyrolean case beyond the Upper Austrian examples.

**Say:** “Von der Burgstraße drei in Götzens zur Sylvester-Jordan-Straße zwölf in Axams.”

**Try these transcription variants:**

- `Gotzens` instead of `Götzens`.
- `Aksams` instead of `Axams`.
- `Silvester Jordan Straße` instead of `Sylvester-Jordan-Straße`.

**Expected behavior:** consider spelling variants within the supplied location context. Keep the destination in Axams. A matcher restricted to another region should explain its boundary or use a supported fallback.

### AT-04 — Gramastetten to Puchenau

**Why it is difficult:** consonant clusters, doubled letters and a town-name change that resembles an ordinary German word.

**Say:** “Von der Marktstraße siebzehn in Gramastetten zur Kirchenstraße eins in Puchenau.”

**Try these transcription variants:**

- `Gramasteten` instead of `Gramastetten`.
- `Grammastetten` instead of `Gramastetten`.
- `Buchenau` instead of `Puchenau`.

**Expected behavior:** use the supplied postcode 4048 to help resolve a town-name substitution. Do not accept a different place just because its name is a close spelling match. If no postcode is known, ask a focused question.

### AT-05 — Gallneukirchen to Ottensheim

**Why it is difficult:** a compound town name can be split into words; missing letters and word boundaries can change the transcription.

**Say:** “Von der Reichenauer Straße eins in Gallneukirchen zum Marktplatz sieben in Ottensheim.”

**Try these transcription variants:**

- `Gall Neu Kirchen` instead of `Gallneukirchen`.
- `Galneukirchen` instead of `Gallneukirchen`.
- `Otensheim` instead of `Ottensheim`.

**Expected behavior:** handle spacing and minor spelling differences while retaining the correct municipality and house number. An available ride must not justify choosing the wrong location.

## How to run each case

1. Create the offered ride using the staging driver account, its approved vehicle and the correct map locations. Record the ride ID and actual departure time.
2. Sign the local app into the separate staging passenger account. Ask Fonio for the route and provide the corresponding date, time and passenger count when asked.
3. Run a correctly spoken baseline, then a challenging spoken version. Save the actual Fonio transcript, returned candidates and selected locations.
4. Separately submit synthetic variants to the relevant search endpoint when isolating string-processor behavior. These tests do not measure speech recognition.
5. Verify that a correct location advances, ambiguous locations produce a short choice, and unresolved names produce clarification. A clear refusal is preferable to an incorrect confident match.
6. After hearing the full trip, explicitly agree to send the request. Check that it exists in mobie as pending, then approve it through the driver account. Reset bookings/seat availability before repeating a successful booking test.

Levenshtein matching is planned in the current branch. It compares spelling; it does not by itself understand pronunciation or establish caller intent. See the [guided booking contract](fonio-guided-booking-contract.md) for the target conversation and the [challenge brief](../challenge.md) for evaluation requirements.
