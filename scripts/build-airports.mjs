/**
 * Builds the bundled airport list for the flight form (sprint 5 AC-4, design
 * 5). Sources: OurAirports airports.csv (public domain) and the time zones of
 * mwgg/Airports (MIT), both credited in the app's "Sources" sheet. Kept: rows
 * with an IATA code, scheduled service, a large or medium airport (or a
 * small one with scheduled service), and a known time zone.
 *
 * Each airport gets the globe area (adm0) of its country, and a Hebrew city
 * name when the city list of sprint 3 (assets/data/cities.dat) has the same
 * city in that area. Israel's airports have fixed Hebrew names (design 5).
 *
 * The downloads are manual:
 *   https://davidmegginson.github.io/ourairports-data/airports.csv
 *   https://raw.githubusercontent.com/mwgg/Airports/master/airports.json
 * into .cache/airports/ (airports.csv, mwgg.json), then:
 *   node scripts/build-airports.mjs
 * Output: apps/mobile/assets/data/airports.dat (JSON text, loaded as an asset
 * only when the airport picker opens).
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache', 'airports');
const outFile = join(root, 'apps', 'mobile', 'assets', 'data', 'airports.dat');
/** Design 5 / AC-4: the file stays small enough to bundle. */
export const MAX_GZIP_BYTES = 150 * 1024;

/** Israel's airports by their Hebrew names (design 5: fixed, not matched). */
const ISRAEL = {
  TLV: ['תל אביב', 'נתב"ג'],
  ETM: ['אילת', 'רמון'],
  HFA: ['חיפה', 'חיפה'],
};

/** Municipalities spelled differently in the city list. */
const ALIASES = { 'New York': 'New York City' };

const RANK = { large_airport: 0, medium_airport: 1, small_airport: 2 };

/** RFC 4180 CSV: quoted fields, doubled quotes, commas inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) rows.push([...row, field]);
  return rows;
}

const fold = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** "Suvarnabhumi Airport" → "Suvarnabhumi"; the full name stays as well. */
export function shortName(name) {
  const short = name
    .replace(/\b(International|Intl\.?|Regional|Municipal)\b/gi, '')
    .replace(/\bAirport\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return short || name;
}

/**
 * The airport rows from the sources. Pure, for tests: csv rows, the mwgg
 * object, ISO2 → adm0, and adm0 → [[id, nameHe, nameEn, ascii, population]].
 */
export function buildAirports(csvRows, mwgg, adm0Of, citiesByArea) {
  const [header, ...data] = csvRows;
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const byIcao = new Map();
  const byIata = new Map();
  for (const a of Object.values(mwgg)) {
    if (!a.tz) continue;
    if (a.icao) byIcao.set(a.icao, a);
    if (a.iata) byIata.set(a.iata, a);
  }
  const out = new Map();
  for (const r of data) {
    const iata = r[col.iata_code];
    const type = r[col.type];
    if (!/^[A-Z]{3}$/.test(iata ?? '') || r[col.scheduled_service] !== 'yes' || !(type in RANK))
      continue;
    const icao = r[col.icao_code] || r[col.gps_code] || r[col.ident];
    const known = byIcao.get(icao) ?? byIata.get(iata);
    const country = r[col.iso_country];
    // Every Israeli airport is on Israel time (mwgg has Ramon on Amman's).
    const tz = country === 'IL' ? 'Asia/Jerusalem' : known?.tz;
    const adm0 = adm0Of.get(country);
    if (!tz || !adm0) continue;
    const name = r[col.name].trim();
    const cityEn = (r[col.municipality] || '').trim();
    let cityHe = '';
    if (ISRAEL[iata]) cityHe = ISRAEL[iata][0];
    else {
      const area = (citiesByArea[adm0] ?? []).filter((c) => c[1]);
      const named = (city) => {
        const key = fold(ALIASES[city] ?? city);
        return area
          .filter((c) => fold(c[2]) === key || fold(c[3] || c[2]) === key)
          .sort((a, b) => b[4] - a[4])[0];
      };
      // The municipality, then mwgg's city, then a big city the airport is named after.
      const folded = ` ${fold(name)} `;
      const match =
        (cityEn && named(cityEn)) ||
        (known?.city && named(known.city)) ||
        area
          .filter((c) => c[4] >= 300_000 && folded.includes(` ${fold(c[2])} `))
          .sort((a, b) => b[4] - a[4])[0];
      if (match) cityHe = match[1];
    }
    const nameHe = ISRAEL[iata]?.[1] ?? '';
    const row = [iata, adm0, country, tz, cityHe, cityEn, name, RANK[type], nameHe];
    // One row per code: the bigger airport wins a duplicated code.
    const prev = out.get(iata);
    if (!prev || prev[7] > row[7]) out.set(iata, row);
  }
  return [...out.values()].sort((a, b) => a[7] - b[7] || a[0].localeCompare(b[0]));
}

async function main() {
  const csv = await readFile(join(cache, 'airports.csv'));
  const mwggBytes = await readFile(join(cache, 'mwgg.json'));
  const countries = JSON.parse(
    await readFile(join(root, 'apps/mobile/assets/geo/countries.geojson'), 'utf8'),
  );
  const cities = JSON.parse(
    await readFile(join(root, 'apps/mobile/assets/data/cities.dat'), 'utf8'),
  );
  const adm0Of = new Map();
  for (const f of countries.features) {
    const { code, adm0 } = f.properties;
    // The first area with a code is the country itself (Gaza's PSX comes later than ISR for IL? no: it has its own code).
    if (code && !adm0Of.has(code)) adm0Of.set(code, adm0);
  }
  adm0Of.set('IL', 'ISR');
  const rows = buildAirports(
    parseCsv(csv.toString('utf8')),
    JSON.parse(mwggBytes.toString('utf8')),
    adm0Of,
    cities.areas,
  );
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const doc = {
    format: 'travel-app-airports',
    version: 1,
    source: {
      ourairports: {
        licence: 'Public Domain',
        url: 'https://ourairports.com/data/',
        sha256: sha(csv),
      },
      mwgg: { licence: 'MIT', url: 'https://github.com/mwgg/Airports', sha256: sha(mwggBytes) },
    },
    columns: ['iata', 'adm0', 'country', 'tz', 'cityHe', 'cityEn', 'name', 'rank', 'nameHe'],
    rows,
  };
  const text = JSON.stringify(doc);
  const gz = gzipSync(text).length;
  if (gz > MAX_GZIP_BYTES)
    throw new Error(`airports.dat is ${gz} bytes gzipped, over ${MAX_GZIP_BYTES}`);
  await writeFile(outFile, text);
  const he = rows.filter((r) => r[4]).length;
  console.log(
    `${rows.length} airports, ${he} with a Hebrew city, ${text.length} bytes (${gz} gzipped)`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
