const CITY_ALIASES: Readonly<Record<string, string>> = {
  vienna: 'wien',
  vienne: 'wien',
  vien: 'wien',
};

function germanTransliteration(value: string): string {
  return value
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

export function normalizeAustrianAddress(value: string): string {
  const lower = germanTransliteration(value.normalize('NFKC').toLocaleLowerCase('de-AT'));
  return lower
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/str\.?(?=\s|$)/g, 'strasse')
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizedVariants(value: string): readonly string[] {
  const normalized = normalizeAustrianAddress(value);
  const accentInsensitive = normalized
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u');
  return accentInsensitive === normalized ? [normalized] : [normalized, accentInsensitive];
}

export function canonicalCitySearch(value: string): string {
  const normalized = normalizeAustrianAddress(value);
  return CITY_ALIASES[normalized] ?? value.trim();
}
