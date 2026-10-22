#!/usr/bin/env node
/**
 * Builds the per-country data shown on the globe card (sprint 0 AC-4): the
 * time zone (and a city name when a country spans several offsets) and the
 * local currency with its Hebrew name and symbol.
 *
 * Hermes on Android has no Intl.DisplayNames and no DateTimeFormat
 * formatToParts, so names and symbols are resolved here, with Node's full ICU,
 * and shipped as a small JSON file keyed by adm0 (unique per area).
 *
 * Inputs: apps/mobile/assets/geo/countries.geojson (run build-countries first),
 * countries-and-timezones and country-to-currency (pinned devDependencies).
 *
 * Usage: node scripts/build-country-meta.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ct from 'countries-and-timezones';
import countryToCurrency from 'country-to-currency';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bordersFile = join(root, 'apps', 'mobile', 'assets', 'geo', 'countries.geojson');
const outFile = join(root, 'apps', 'mobile', 'src', 'features', 'globe', 'countryMeta.json');

/**
 * Countries whose zones have different UTC offsets show the capital's time,
 * labelled with the city. Every such country must be listed here; the build
 * fails otherwise, so a new zone split can't slip through silently.
 */
const CAPITAL_ZONE = {
  AU: ['Australia/Sydney', 'קנברה'],
  BR: ['America/Sao_Paulo', 'ברזיליה'],
  CA: ['America/Toronto', 'אוטווה'],
  CD: ['Africa/Kinshasa', 'קינשסה'],
  CL: ['America/Santiago', 'סנטיאגו'],
  CN: ['Asia/Shanghai', "בייג'ינג"],
  EC: ['America/Guayaquil', 'קיטו'],
  ES: ['Europe/Madrid', 'מדריד'],
  FM: ['Pacific/Pohnpei', 'פליקיר'],
  GL: ['America/Nuuk', 'נואוק'],
  ID: ['Asia/Jakarta', "ג'קרטה"],
  KI: ['Pacific/Tarawa', 'טאראווה'],
  MN: ['Asia/Ulaanbaatar', 'אולן בטור'],
  MX: ['America/Mexico_City', 'מקסיקו סיטי'],
  NZ: ['Pacific/Auckland', 'ולינגטון'],
  PF: ['Pacific/Tahiti', 'פאפטה'],
  PG: ['Pacific/Port_Moresby', 'פורט מורסבי'],
  PT: ['Europe/Lisbon', 'ליסבון'],
  RU: ['Europe/Moscow', 'מוסקבה'],
  TF: ['Indian/Kerguelen', 'קרגלן'],
  UA: ['Europe/Kyiv', 'קייב'],
  US: ['America/New_York', 'וושינגטון'],
};

/** Areas whose data comes from somewhere other than their ISO code (by adm0). */
const AREA_OVERRIDES = {
  // Uninhabited: no local time or currency to show.
  ATA: { timeZone: null, currency: null }, // Antarctica
  CSI: { timeZone: null, currency: null }, // Coral Sea Islands
  ATC: { timeZone: null, currency: null }, // Ashmore and Cartier Islands
  CLP: { timeZone: null, currency: null }, // Clipperton Island
  HMD: { timeZone: null, currency: null }, // Heard Island and McDonald Islands
  UMI: { timeZone: null, currency: null }, // US Minor Outlying Islands
  // Territories that share their parent's ISO code but not its clock.
  IOA: { timeZone: 'Indian/Christmas', city: 'אי חג המולד' }, // Australian Indian Ocean Territories
  BRI: { timeZone: 'America/Sao_Paulo' }, // Brazilian Island (southern Brazil)
  // Kosovo has no IANA entry of its own; it keeps Belgrade's time.
  KOS: { timeZone: 'Europe/Belgrade' },
};

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function currencySymbol(code) {
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency: code,
    currencyDisplay: 'narrowSymbol',
  })
    .formatToParts(0)
    .find((part) => part.type === 'currency').value;
}

const hebrewCurrencyNames = new Intl.DisplayNames(['he'], { type: 'currency', fallback: 'none' });

function timeZoneFor(code) {
  if (CAPITAL_ZONE[code]) {
    const [timeZone, city] = CAPITAL_ZONE[code];
    return { timeZone, city };
  }
  const country = ct.getCountry(code, { deprecated: false });
  const zones = country
    ? country.timezones.map((name) => ct.getTimezone(name)).filter(Boolean)
    : [];
  if (zones.length === 0) return { timeZone: null };
  const offsets = new Set(zones.map((z) => `${z.utcOffsetStr}/${z.dstOffsetStr}`));
  if (offsets.size > 1) {
    throw new Error(`${code} spans ${offsets.size} UTC offsets; add it to CAPITAL_ZONE.`);
  }
  return { timeZone: zones[0].name };
}

function currencyFor(code) {
  const currency = countryToCurrency[code];
  if (!currency) return null;
  const nameHe = hebrewCurrencyNames.of(currency);
  if (!nameHe) throw new Error(`No Hebrew name for currency ${currency} (${code}).`);
  return { code: currency, nameHe, symbol: currencySymbol(currency) };
}

async function main() {
  const { features } = JSON.parse(await readFile(bordersFile, 'utf8'));
  const meta = {};

  for (const { properties } of features) {
    const { adm0, code } = properties;
    if (!code) continue; // not selectable (e.g. Gaza Strip, military bases)

    const override = AREA_OVERRIDES[adm0] ?? {};
    const zone =
      'timeZone' in override
        ? { timeZone: override.timeZone, city: override.city }
        : timeZoneFor(code);
    const currency = 'currency' in override ? override.currency : currencyFor(code);

    if (zone.timeZone && !isValidTimeZone(zone.timeZone)) {
      throw new Error(`${adm0}: unknown time zone ${zone.timeZone}`);
    }

    const entry = {};
    if (zone.timeZone) entry.timeZone = zone.timeZone;
    if (zone.city) entry.city = zone.city;
    if (currency) entry.currency = currency;
    meta[adm0] = entry;
  }

  const sorted = Object.fromEntries(Object.entries(meta).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(outFile, JSON.stringify(sorted, null, 2) + '\n');

  const entries = Object.values(sorted);
  console.log(`Wrote ${outFile}`);
  console.log(`  areas: ${entries.length}`);
  console.log(`  with time zone: ${entries.filter((e) => e.timeZone).length}`);
  console.log(`  with currency: ${entries.filter((e) => e.currency).length}`);
  console.log(`  with city label: ${entries.filter((e) => e.city).length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
