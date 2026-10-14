import { mkdir, writeFile } from 'node:fs/promises';

if (!process.env.STARTER_API_KEY) throw new Error('Load .env before generating the Fonio configuration.');
const tunnels = await (await fetch('http://127.0.0.1:4040/api/tunnels')).json();
const origin = tunnels.tunnels.find(tunnel => tunnel.proto === 'https')?.public_url;
if (!origin) throw new Error('Start ngrok http 3000 before generating the Fonio configuration.');

const config = {
  name: 'mobie_search_rides',
  run: 'During the conversation',
  availability: 'Always',
  when_should_the_ai_use_this: 'Wenn Start, Ziel, Reisedatum, Uhrzeit und Sitzplatzanzahl vollständig und von der anrufenden Person bestätigt sind, suche mit diesem Werkzeug nach passenden Fahrten.',
  request: {
    method: 'POST',
    url: `${origin}/api/trips/search`,
    headers: { Authorization: `Bearer ${process.env.STARTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: { departure: '{{departure}}', destination: '{{destination}}', time: '{{time}}', seatsRequested: '{{seats_requested}}' },
  },
  custom_variables: [
    { name: 'departure', type: 'String', description: 'Bestätigte Startadresse mit Straße, Hausnummer, Postleitzahl und Gemeinde.' },
    { name: 'destination', type: 'String', description: 'Bestätigte Zieladresse mit Straße, Hausnummer, Postleitzahl und Gemeinde.' },
    { name: 'time', type: 'String', description: 'Bestätigte Reisezeit als ISO-8601-Zeitstempel mit Z oder explizitem Offset, zum Beispiel 2026-10-19T15:00:00+02:00.' },
    { name: 'seats_requested', type: 'String', description: 'Bestätigte Sitzplatzanzahl als ganze Zahl von 1 bis 8.' },
  ],
  execution_sentence: 'Ich suche jetzt nach passenden Fahrten.',
  response_instructions: 'Die Antwort ist die unveränderte Mobie-Fahrtenliste. Wenn sie leer ist, sage, dass keine passende Fahrt gefunden wurde. Fasse sonst die passenden Fahrten zusammen. Diese Integration bucht keine Fahrt.',
};

await mkdir('.local', { recursive: true });
const file = '.local/fonio-trip-search.json';
await writeFile(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Fonio dashboard values saved to ignored ${file}.`);
console.log(`URL: ${config.request.url}`);
console.log('The local file includes the authorization header.');
