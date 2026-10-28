#!/usr/bin/env node
/**
 * Builds the emergency data of sprint 8 F-022 (AC-11 to AC-17): Israel's
 * missions and the checked local emergency numbers, as
 *   - a migration that fills public.missions and public.emergency_numbers, and
 *   - apps/mobile/src/features/emergency/emergencyData.json, bundled so the
 *     SOS screen works offline and signed out (AC-17).
 *
 * Missions: the data.gov.il dataset "ntz-short" (רשימת נציגויות ישראל בעולם),
 * English and Hebrew CSVs fetched through its CKAN API. Each row is a
 * (country, mission) pair; rows of one mission share k_ntz, and the first is
 * the host country. UN/EU/OECD delegations aren't consular and are dropped;
 * a "Non Resident" row, or a country missing from the list, has no mission
 * (mission_status 'none', with the dataset as the source). A country missing
 * from the list stays 'pending'.
 *
 * Numbers: scripts/data/emergency-numbers.json, only the countries checked
 * against FCDO travel advice (OGL v3.0) and an official local source. Every
 * other country stays 'pending' ("בהשלמה"), never a guess (AC-14).
 *
 * Usage: node scripts/build-emergency.mjs [--fetch]
 *   --fetch downloads the dataset into .cache/missions/ first.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache', 'missions');
const metaFile = join(root, 'apps', 'mobile', 'src', 'features', 'globe', 'countryMeta.json');
const numbersFile = join(root, 'scripts', 'data', 'emergency-numbers.json');
const outJson = join(root, 'apps', 'mobile', 'src', 'features', 'emergency', 'emergencyData.json');
const outSql = join(root, 'supabase', 'migrations', '20261030110000_emergency_data.sql');

export const DATASET_URL = 'https://data.gov.il/dataset/ntz-short';
const RESOURCES = {
  en: '6fc859cb-8a6f-458b-bd5a-9bd0cfbfce11',
  he: '4d1ce6f0-08d9-4294-a7ae-aae1b29bb769',
};
/** The day the dataset was read; shown as "אומת ב-" for missions. */
export const MISSIONS_READ_ON = '2026-10-28';

/** Dataset country names that differ from Natural Earth's English names. */
export const NAME_TO_ADM0 = {
  "Cote d'Ivoire": 'CIV',
  China: 'CHN',
  'Russian Federation': 'RUS',
  Korea: 'KOR',
  'Viet Nam': 'VNM',
  'Holy See': 'VAT',
  'Slovak, The Republic': 'SVK',
  Bahamas: 'BHS',
  Gambia: 'GMB',
  'Trinidad & Tobago': 'TTO',
  Micronesia: 'FSM',
  'Sao Tome and Principe': 'STP',
  'St. Vincent - The Grenadines': 'VCT',
  'St. Lucia': 'LCA',
  'St. Kitts and Nevis': 'KNA',
  // Served from Yaoundé: the Republic of the Congo (Brazzaville).
  Congo: 'COG',
  'United Republic of Tanzania': 'TZA',
  'Republic Of Palau': 'PLW',
};

/** Phones the dataset writes wrongly, fixed by hand from the mission's own page. */
export const PHONE_FIXES = {
  // "00-886-886-227579692": the country code twice.
  '00-886-886-227579692': '+886227579692',
  // The same doubling in Stockholm and Hanoi (Dudi review 1).
  '00-46-46-852806500': '+46852806500',
  '00-84-84-2437187500': '+842437187500',
  // Côte d'Ivoire numbers have 10 digits since 2021.
  '00-225-225-0769717644': '+2250769717644',
};

/**
 * Missions whose host the dataset files under the sovereign: the Hong Kong
 * consulate serves Hong Kong and Macau, not all of China (Dudi review 7).
 */
export const HOSTS = { 'Hong-Kong': ['HKG', 'MAC'] };

const decode = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** "00-54-11-37244500" → "+541137244500"; the first number when there are two. */
export function normalizeTel(raw) {
  const text = decode(raw);
  if (!text) return null;
  if (PHONE_FIXES[text]) return PHONE_FIXES[text];
  // "00-46-46-…": the country code twice. Still valid E.164, so only a hand fix will do.
  const groups = text.split('-');
  if (groups[0] === '00' && groups[1] && groups[1] === groups[2]) {
    throw new Error(`Country code twice, add it to PHONE_FIXES: ${text}`);
  }
  const first = text.split(/\s{1,}(?=00|\+)|,|;/)[0].split('/')[0];
  const digits = first.replace(/[^0-9+]/g, '');
  const e164 = digits.startsWith('+')
    ? digits
    : digits.startsWith('00')
      ? `+${digits.slice(2)}`
      : null;
  return e164 && /^\+[1-9][0-9]{7,14}$/.test(e164) ? e164 : null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Fri - Fri 09:30 12:00  Mon - Thu 09:30 12:30" → "Mon - Thu 09:30 12:30 · Fri 09:30 12:00" (Dudi review 7). */
export function hoursOf(raw) {
  const parts = String(raw ?? '')
    .split(/\s{2,}/)
    .map((p) => p.trim().replace(/^(\w{3}) - \1\b/, '$1'))
    .filter(Boolean);
  if (!parts.length) return null;
  const day = (p) => DAYS.indexOf(p.slice(0, 3));
  return [...parts].sort((a, b) => day(a) - day(b)).join(' · ');
}

const KIND = {
  Embassy: 'embassy',
  'Consulate General': 'consulate',
  Consulate: 'consulate',
  'Economic and Cultural Office': 'office',
  'Liaison Office': 'office',
};

/** A gov.il page for the mission when the dataset gives one, else the dataset. */
export function sourceOf(atar) {
  const url = decode(atar);
  return /^https:\/\/([a-z0-9-]+\.)*(gov\.il)(\/|$)/i.test(url) ? url : DATASET_URL;
}

/**
 * Missions with the countries they cover, and the countries listed without
 * one ("Non Resident"). `adm0Of` maps a dataset name to adm0 (throws on an unknown name).
 */
export function buildMissions(en, he, adm0Of) {
  if (
    en.length !== he.length ||
    en.some((r, i) => he[i]._id !== r._id || he[i].k_ntz !== r.k_ntz)
  ) {
    throw new Error('The English and Hebrew lists no longer line up by _id and k_ntz');
  }
  const groups = new Map();
  const without = new Set();
  en.forEach((r, i) => {
    const adm0 = adm0Of(decode(r.shem_mdn_a));
    const kind = KIND[decode(r.maamad_a)];
    if (decode(r.maamad_a) === 'Delegation') return;
    if (!kind) {
      // A row with no mission type (Qatar, the ministry's own number): no mission there.
      // "Non Resident" usually means served from elsewhere: unknown, so 'pending' (Dudi review 6).
      if (decode(r.maamad_a) !== 'Non Resident') without.add(adm0);
      return;
    }
    const g = groups.get(r.k_ntz) ?? { rows: [] };
    g.rows.push({ en: r, he: he[i], adm0, kind });
    groups.set(r.k_ntz, g);
  });
  const missions = [...groups.entries()].map(([k, g]) => {
    const host = g.rows[0];
    const own = HOSTS[decode(host.en.shem_ntz_a)];
    const covers = own ?? [...new Set(g.rows.map((x) => x.adm0))];
    return {
      id: Number(k),
      adm0: own?.[0] ?? host.adm0,
      kind: host.kind,
      nameHe: `${decode(host.he.maamad)} ${decode(host.he.shem_ntz)}`.trim(),
      nameEn: `${decode(host.en.maamad_a)}, ${decode(host.en.shem_ntz_a)}`,
      cityHe: decode(host.he.shem_ntz) || null,
      cityEn: decode(host.en.shem_ntz_a) || null,
      addressHe: decode(host.he.Address) || null,
      addressEn: decode(host.en.Addrs) || null,
      hoursHe: decode(host.he.Kabala) || null,
      hoursEn: hoursOf(host.en.Kabala),
      phone: normalizeTel(host.en.tel),
      covers,
      sourceUrl: sourceOf(host.en.Atar),
    };
  });
  missions.sort((a, b) => a.id - b.id);
  const covered = new Set(missions.flatMap((m) => m.covers));
  for (const a of covered) without.delete(a);
  return { missions, without: [...without].sort() };
}

const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

export function toSql(missions, countries) {
  const lines = [
    '-- Generated by scripts/build-emergency.mjs: do not edit by hand.',
    `-- Missions: data.gov.il ntz-short, read on ${MISSIONS_READ_ON}. Numbers: scripts/data/emergency-numbers.json.`,
    '',
    'insert into public.missions (id, adm0, kind, name_he, name_en, city_he, city_en, address_he, address_en,',
    '  hours_he, hours_en, phone, covers, source_url, verified_at) values',
    missions
      .map(
        (m) =>
          `  (${m.id}, ${q(m.adm0)}, ${q(m.kind)}, ${q(m.nameHe)}, ${q(m.nameEn)}, ${q(m.cityHe)}, ${q(m.cityEn)}, ` +
          `${q(m.addressHe)}, ${q(m.addressEn)}, ${q(m.hoursHe)}, ${q(m.hoursEn)}, ${q(m.phone)}, ` +
          `array[${m.covers.map(q).join(', ')}], ${q(m.sourceUrl)}, ${q(MISSIONS_READ_ON)})`,
      )
      .join(',\n') + ';',
    '',
    'insert into public.emergency_numbers (adm0, police, ambulance, fire, tourist_police, shared,',
    '  numbers_status, mission_status, source_url, verified_at) values',
    countries
      .map(
        (c) =>
          `  (${q(c.adm0)}, ${q(c.police)}, ${q(c.ambulance)}, ${q(c.fire)}, ${q(c.touristPolice)}, ${q(c.shared)}, ` +
          `${q(c.numbersStatus)}, ${q(c.missionStatus)}, ${q(c.sourceUrl)}, ${q(c.verifiedAt)})`,
      )
      .join(',\n') + ';',
    '',
  ];
  return lines.join('\n');
}

async function fetchDataset() {
  await mkdir(cacheDir, { recursive: true });
  for (const [lang, id] of Object.entries(RESOURCES)) {
    const res = await fetch(
      `https://data.gov.il/api/3/action/datastore_search?resource_id=${id}&limit=1000`,
    );
    if (!res.ok) throw new Error(`data.gov.il ${lang}: HTTP ${res.status}`);
    await writeFile(join(cacheDir, `${lang}.json`), await res.text());
  }
}

async function main() {
  if (process.argv.includes('--fetch')) await fetchDataset();
  const read = async (f) => JSON.parse(await readFile(f, 'utf8'));
  const [enDoc, heDoc, meta, numbers] = await Promise.all([
    read(join(cacheDir, 'en.json')),
    read(join(cacheDir, 'he.json')),
    read(metaFile),
    read(numbersFile),
  ]);
  const byName = new Map(Object.entries(meta).map(([a, v]) => [v.nameEn.toLowerCase(), a]));
  const adm0Of = (name) => {
    const a = NAME_TO_ADM0[name] ?? byName.get(name.toLowerCase());
    if (!a) throw new Error(`Unknown country in the dataset: ${name}`);
    return a;
  };
  const { missions, without } = buildMissions(enDoc.result.records, heDoc.result.records, adm0Of);
  const covered = new Set(missions.flatMap((m) => m.covers));
  const noMission = new Set(without);
  const checked = new Map(numbers.countries.map((c) => [c.adm0, c]));

  // Every sovereign area gets a row; territories (with a parent) use their parent's.
  const countries = Object.entries(meta)
    .filter(([a, v]) => !v.parent && a !== 'ISR')
    .map(([adm0]) => {
      const n = checked.get(adm0);
      // Missing from the list is not proof of no mission: 'pending' ("בהשלמה").
      const missionStatus = covered.has(adm0)
        ? 'covered'
        : noMission.has(adm0)
          ? 'none'
          : 'pending';
      return {
        adm0,
        police: n?.police ?? null,
        ambulance: n?.ambulance ?? null,
        fire: n?.fire ?? null,
        touristPolice: n?.touristPolice ?? null,
        shared: n?.shared ?? null,
        numbersStatus: n ? 'verified' : 'pending',
        missionStatus,
        // A checked row cites its numbers' source; otherwise "no mission" cites the dataset.
        sourceUrl: n ? n.sourceUrl : missionStatus === 'none' ? DATASET_URL : null,
        verifiedAt: n ? n.verifiedAt : null,
      };
    })
    .sort((a, b) => a.adm0.localeCompare(b.adm0));
  for (const a of without) {
    if (!countries.some((c) => c.adm0 === a)) throw new Error(`No country row for ${a}`);
  }

  const digest = createHash('sha256')
    .update(JSON.stringify([enDoc.result.records, heDoc.result.records]))
    .digest('hex');
  await mkdir(dirname(outJson), { recursive: true });
  await writeFile(
    outJson,
    JSON.stringify(
      {
        source: { missions: DATASET_URL, readOn: MISSIONS_READ_ON, sha256: digest },
        missions,
        countries,
      },
      null,
      0,
    ) + '\n',
  );
  await writeFile(outSql, toSql(missions, countries));
  console.log(
    `${missions.length} missions, ${countries.length} countries ` +
      `(${countries.filter((c) => c.numbersStatus === 'verified').length} with checked numbers, ` +
      `${countries.filter((c) => c.missionStatus === 'none').length} without a mission)`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
