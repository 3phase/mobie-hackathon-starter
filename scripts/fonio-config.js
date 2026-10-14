import { mkdir, writeFile } from 'node:fs/promises';

if (!process.env.STARTER_API_KEY) throw new Error('Load .env before generating the Fonio configuration.');
const tunnels = await (await fetch('http://127.0.0.1:4040/api/tunnels')).json();
const origin = tunnels.tunnels.find(tunnel => tunnel.proto === 'https')?.public_url;
if (!origin) throw new Error('Start ngrok http 3000 before generating the Fonio configuration.');
const lookup = process.argv.includes('--lookup');

const config = {
  name: 'mobie_resolve_location',
  run: 'During the conversation',
  availability: 'Always',
  when_should_the_ai_use_this: 'Wenn die anrufende Person einen Start- oder Zielort nennt, verwende dieses Werkzeug, um passende Orte zu finden. Suche Start und Ziel getrennt. Frage zuerst nach der Gemeinde oder Postleitzahl, wenn der Ort unklar ist. Verwende das Ergebnis, um die gewünschte Adresse zu bestätigen.',
  request: {
    method: 'POST',
    url: `${origin}${lookup ? '/api/locations/search' : '/api/addresses/receive'}`,
    headers: { Authorization: `Bearer ${process.env.STARTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: { query: '{{spoken_address}}' },
  },
  custom_variables: [{
    name: 'spoken_address',
    type: 'String',
    description: 'Die von der anrufenden Person genannte Adresse mit Straße, Hausnummer, Gemeinde und Postleitzahl, soweit vorhanden. Übernimm die verstandene Schreibweise und korrigiere schwierige Namen nicht eigenständig. Erfinde keine fehlenden Angaben. Maximal 256 Zeichen. Nur eine Adresse pro Anfrage.',
  }],
  execution_sentence: 'Ich prüfe die Adresse kurz.',
  response_instructions: 'Lies den passenden Adresskandidaten zur Bestätigung vor. Bei mehreren plausiblen Treffern frage gezielt nach Gemeinde, Postleitzahl oder Hausnummer. Wenn kein passender Treffer vorhanden ist, frage nach einer Präzisierung. Verwende nur zurückgegebene Koordinaten. Diese Integration sucht Orte und bucht keine Fahrt.',
};

if (!lookup) {
  config.when_should_the_ai_use_this = 'Sobald der Anrufer eine Adresse nennt, sende diese mit diesem Werkzeug an unsere App.';
  config.custom_variables[0].description = 'Die Adresse, die der Anrufer nennt. Übernimm sie so, wie du sie verstanden hast. Erfinde keine Angaben. Maximal 256 Zeichen.';
  config.execution_sentence = 'Ich sende die Adresse kurz.';
  config.response_instructions = 'Wenn die Antwort received: true enthält, sage: Danke, die Adresse ist in unserer App angekommen. Prüfe keine Adresse und suche oder buche keine Fahrt.';
}

await mkdir('.local', { recursive: true });
const file = `.local/fonio-address-${lookup ? 'lookup' : 'receive'}.json`;
await writeFile(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Fonio dashboard values saved to ignored ${file}.`);
console.log(`URL: ${config.request.url}`);
console.log('The local file includes the authorization header.');
