/**
 * Sprint 11 F-029 (ADR-016, Raz D10, D11): the places of "What to see", from
 * Wikidata (CC0; no account, no key). Credited in the app's "Sources" sheet.
 *
 * For every globe area with a Wikidata country (ISO 3166-1 alpha-3, P298),
 * one SPARQL query per category group asks for items in that country with
 * coordinates, of the group's classes (instance of, or a subclass of), with
 * their Hebrew and English labels and their number of Wikipedia sitelinks
 * (the popularity). No descriptions (Wikipedia text is CC BY-SA) and no
 * Commons images.
 *
 * Kept: the 60 most popular in the area, plus up to 20 within 15 km of each
 * of its bundled cities (D18, Yossi 29.10: recommendations by city). An item in several groups takes the
 * group of its highest-priority class (CLASSES order).
 *
 * Answers are cached in .cache/wikidata/<adm0>.<group>.json, so a rerun only
 * asks for what's missing; the build writes their SHA-256 into the output.
 *   node scripts/build-places.mjs            query (cached), then write
 *   node scripts/build-places.mjs --offline  write from the cache only
 * Output: supabase/migrations/<stamp>_places_data.sql (a data migration;
 * upsert by QID, and a place no longer found is hidden, never deleted).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache', 'wikidata');
export const OUTPUT = join(root, 'supabase', 'migrations', '20261101090100_places_data.sql');
const ENDPOINT = 'https://query.wikidata.org/sparql';
// Wikimedia's User-Agent policy: who we are and how to reach us.
const USER_AGENT = 'TravelAppBuild/0.12 (places for a travel app; github.com/yossile94/Travel-app)';

/** Category groups and their classes, in priority order (D10, D12). */
export const CLASSES = [
  ['family', ['Q43501', 'Q2281788', 'Q194195', 'Q2416723', 'Q740326']], // zoo, aquarium, amusement, theme, water park
  ['nature', ['Q46169', 'Q34038', 'Q40080', 'Q179049', 'Q167346']], // national park, waterfall, beach, reserve, botanical garden
  [
    'culture',
    ['Q33506', 'Q16560', 'Q23413', 'Q839954', 'Q44539', 'Q5393308', 'Q32815', 'Q34627', 'Q16970'],
  ],
  ['food', ['Q330284']], // marketplace
  ['shopping', ['Q11315']], // shopping centre
  ['attraction', ['Q570116']], // tourist attraction
];
export const AREA_MAX = 60;
export const CITY_MAX = 20;
export const CITY_RADIUS_KM = 15;
const NAME_MAX = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(query, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
    }).catch((e) => ({ ok: false, status: 0, statusText: e.message }));
    if (res.ok) return res.json();
    // 429 and timeouts: back off and try again.
    console.warn(`  wikidata ${res.status} ${res.statusText}, attempt ${attempt}`);
    await sleep(5000 * attempt);
  }
  throw new Error(`wikidata: no answer after ${attempts} attempts`);
}

const countryQuery = `SELECT ?c ?iso WHERE { ?c wdt:P298 ?iso . FILTER NOT EXISTS { ?c wdt:P576 ?end } }`;

/**
 * deep: instance of a class or of any subclass (P31/P279*). Large countries can
 * time out on that; the fallback asks for direct instances only (P31).
 */
function groupQuery(country, classes, deep = true) {
  return `SELECT ?item ?cls ?he ?en ?coord ?links WHERE {
  VALUES ?cls { ${classes.map((c) => `wd:${c}`).join(' ')} }
  ?item wdt:P17 wd:${country} ; ${deep ? 'wdt:P31/wdt:P279*' : 'wdt:P31'} ?cls ; wdt:P625 ?coord ; wikibase:sitelinks ?links .
  FILTER(?links >= 2)
  OPTIONAL { ?item rdfs:label ?he FILTER(lang(?he) = "he") }
  OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en) = "en") }
} ORDER BY DESC(?links) LIMIT 300`;
}

/** "Point(100.5 13.7)" → [lon, lat], or null. */
export function point(wkt) {
  const m = /^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/.exec(wkt ?? '');
  if (!m) return null;
  const [lon, lat] = [Number(m[1]), Number(m[2])];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

export function km([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** A name for the table: trimmed, one line, no control characters; null if unusable. */
export function cleanName(name) {
  const s = (name ?? '')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || /^Q\d+$/.test(s)) return null;
  return [...s].length <= NAME_MAX ? s : null;
}

/**
 * One area's rows from its group answers: each item once, in its best group;
 * the area's top 60, plus up to 20 near each of its cities.
 */
export function selectPlaces(adm0, answers, cities) {
  const best = new Map();
  CLASSES.forEach(([group], priority) => {
    for (const b of answers[group] ?? []) {
      const qid = b.item.value.split('/').pop();
      const at = point(b.coord?.value);
      const en = cleanName(b.en?.value);
      const he = cleanName(b.he?.value);
      if (!at || !(en || he)) continue;
      const prev = best.get(qid);
      if (prev && prev.priority <= priority) continue;
      best.set(qid, {
        qid,
        adm0,
        group,
        priority,
        he,
        en: en ?? he,
        at,
        links: Number(b.links.value),
      });
    }
  });
  const all = [...best.values()].sort((a, b) => b.links - a.links || a.qid.localeCompare(b.qid));
  const kept = new Map(all.slice(0, AREA_MAX).map((p) => [p.qid, p]));
  for (const city of cities) {
    all
      .filter((p) => km(p.at, city) <= CITY_RADIUS_KM)
      .slice(0, CITY_MAX)
      .forEach((p) => kept.set(p.qid, p));
  }
  return [...kept.values()].sort((a, b) => b.links - a.links || a.qid.localeCompare(b.qid));
}

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

export function render(rows, sha) {
  const lines = [
    '-- GENERATED by scripts/build-places.mjs from Wikidata (CC0). Do not edit by hand.',
    `-- Sprint 11 F-029 (ADR-016): ${rows.length} places. Answers' SHA-256: ${sha}`,
    '-- Upsert by QID; a place not in this build is hidden, never deleted (D10).',
    'begin;',
    'create temporary table places_build (like public.places including defaults) on commit drop;',
  ];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows
      .slice(i, i + 500)
      .map(
        (p) =>
          `(${q(p.qid)}, ${q(p.adm0)}, ${q(p.he)}, ${q(p.en)}, ${p.at[1].toFixed(5)}, ${p.at[0].toFixed(5)}, ${q(p.group)}, ${p.links})`,
      );
    lines.push(
      'insert into places_build (wikidata_id, adm0, name_he, name_en, lat, lng, category, popularity) values',
      `${chunk.join(',\n')};`,
    );
  }
  lines.push(
    `insert into public.places (wikidata_id, adm0, name_he, name_en, lat, lng, category, popularity, hidden)
select wikidata_id, adm0, name_he, name_en, lat, lng, category, popularity, false from places_build
on conflict (wikidata_id) do update set
  adm0 = excluded.adm0, name_he = excluded.name_he, name_en = excluded.name_en, lat = excluded.lat,
  lng = excluded.lng, category = excluded.category, popularity = excluded.popularity, hidden = false;`,
    'update public.places p set hidden = true where not exists (select 1 from places_build b where b.wikidata_id = p.wikidata_id);',
    'commit;',
    '',
  );
  return lines.join('\n');
}

/** The bundled cities' points, largest first (same order as cities.dat rows). */
function citiesOf(dat) {
  const out = {};
  for (const [adm0, b64] of Object.entries(dat.points)) {
    const buf = Buffer.from(b64, 'base64');
    const pts = [];
    for (let i = 0; i + 4 <= buf.length; i += 4)
      pts.push([buf.readInt16LE(i) / 100, buf.readInt16LE(i + 2) / 100]);
    out[adm0] = pts;
  }
  return out;
}

async function main() {
  const offline = process.argv.includes('--offline');
  mkdirSync(cacheDir, { recursive: true });
  const meta = JSON.parse(
    readFileSync(join(root, 'apps/mobile/src/features/globe/countryMeta.json'), 'utf8'),
  );
  const cities = citiesOf(
    JSON.parse(readFileSync(join(root, 'apps/mobile/assets/data/cities.dat'), 'utf8')),
  );

  const countriesFile = join(cacheDir, 'countries.json');
  if (!existsSync(countriesFile)) {
    if (offline) throw new Error('no cached country list');
    writeFileSync(countriesFile, JSON.stringify(await sparql(countryQuery)));
  }
  const qidOf = new Map(
    JSON.parse(readFileSync(countriesFile, 'utf8')).results.bindings.map((b) => [
      b.iso.value,
      b.c.value.split('/').pop(),
    ]),
  );

  const hash = createHash('sha256');
  const rows = [];
  const missing = [];
  for (const adm0 of Object.keys(meta).sort()) {
    const country = qidOf.get(adm0);
    if (!country) {
      missing.push(adm0);
      continue;
    }
    const answers = {};
    for (const [group, classes] of CLASSES) {
      const file = join(cacheDir, `${adm0}.${group}.json`);
      if (!existsSync(file)) {
        if (offline) throw new Error(`no cached answer for ${adm0} ${group}`);
        console.log(`${adm0} ${group}`);
        const answer = await sparql(groupQuery(country, classes), 2).catch(async () => {
          console.warn(`  ${adm0} ${group}: direct instances only`);
          return sparql(groupQuery(country, classes, false));
        });
        writeFileSync(file, JSON.stringify(answer));
        await sleep(1000);
      }
      const text = readFileSync(file, 'utf8');
      hash.update(text);
      answers[group] = JSON.parse(text).results.bindings;
    }
    rows.push(...selectPlaces(adm0, answers, cities[adm0] ?? []));
  }
  const sha = hash.digest('hex');
  writeFileSync(OUTPUT, render(rows, sha));
  console.log(
    `${rows.length} places in ${new Set(rows.map((r) => r.adm0)).size} areas; no country for: ${missing.join(' ')}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
