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

// Currency symbols and Hebrew names come from Node's CLDR data; older data
// (Node 22) gives other fallback symbols. Regenerate only with this or newer.
const MIN_CLDR_MAJOR = 48;
if (!(Number.parseInt(process.versions.cldr ?? '', 10) >= MIN_CLDR_MAJOR)) {
  throw new Error(
    `CLDR ${process.versions.cldr ?? '(none)'} is older than ${MIN_CLDR_MAJOR}; use Node 24 LTS.`,
  );
}

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

function symbolIn(locale, currency) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  })
    .formatToParts(0)
    .find((part) => part.type === 'currency').value;
}

/** A real symbol, not the ISO code again (or a look-alike of it) and not an invisible mark. */
function isSymbol(value, currency) {
  const visible = value.replace(/[\p{Cf}\s]/gu, '');
  return visible !== '' && visible.toUpperCase() !== currency && !/^\p{Lu}{3}$/u.test(visible);
}

/**
 * English has symbols only for widely traded currencies; for the rest (AED, KES,
 * PEN…) the symbol locals use comes from the country's own language, then from
 * English as written there (e.g. en-PG → K). Falls back to the code, which the
 * card then shows alone (CHF is written "CHF" in Switzerland too).
 */
function currencySymbol(currency, countryCode) {
  const symbol = symbolIn('en', currency);
  if (isSymbol(symbol, currency)) return symbol;
  const { language } = new Intl.Locale(`und-${countryCode}`).maximize();
  for (const locale of [`${language}-${countryCode}`, `en-${countryCode}`]) {
    const local = symbolIn(locale, currency);
    if (isSymbol(local, currency)) return local;
  }
  return currency;
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

/**
 * Corrections to CLDR's Hebrew currency names. CLDR 48 calls AFN "אפגני
 * אפגני"; "אפגני" is how it is written (sprint 1 AC-12).
 */
const CURRENCY_NAME_FIXES = { AFN: 'אפגני' };

function currencyFor(code) {
  const currency = countryToCurrency[code];
  if (!currency) return null;
  const nameHe = CURRENCY_NAME_FIXES[currency] ?? hebrewCurrencyNames.of(currency);
  if (!nameHe) throw new Error(`No Hebrew name for currency ${currency} (${code}).`);
  return { code: currency, nameHe, symbol: currencySymbol(currency, code) };
}

/**
 * Areas with less land than this (square degrees, latitude-corrected; ~6,000
 * km² at the equator) get an enlarged tap target. Measured by land, not by
 * span, so spread-out archipelagos of tiny islands (Maldives, Kiribati) count.
 */
const SMALL_LAND_AREA = 0.5;

/** Ring area on the sphere (equal-area slices), in square degrees at the equator. */
function ringArea(ring) {
  const toRad = Math.PI / 180;
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    sum += ((x2 - x1) * (Math.sin(y2 * toRad) + Math.sin(y1 * toRad))) / 2;
  }
  return Math.abs(sum) / toRad;
}

function landArea(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce(
    (total, [outer, ...holes]) =>
      total + ringArea(outer) - holes.reduce((sum, hole) => sum + ringArea(hole), 0),
    0,
  );
}

function allPositions(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flat(2);
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The polygon the camera should frame: the one containing the label point,
 * else the largest. Without this, France, the Netherlands and Norway are
 * measured together with their overseas territories and barely get zoomed.
 */
function mainPolygon(geometry, label) {
  if (geometry.type === 'Polygon') return geometry;
  const polygons = geometry.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }));
  return (
    polygons.find((p) => inRing(label, p.coordinates[0])) ??
    polygons.reduce((a, b) => (landArea(b) > landArea(a) ? b : a))
  );
}

/**
 * The size of an area in degrees, taking the longitude span across the
 * shorter side of the antimeridian (Russia, Fiji) and narrowing it by
 * latitude. Used to choose the fly-to zoom.
 */
function spanDegrees(geometry) {
  const positions = allPositions(geometry);
  const lats = positions.map(([, lat]) => lat);
  const lonSpan = (lons) => Math.max(...lons) - Math.min(...lons);
  const lons = positions.map(([lng]) => lng);
  const span = Math.min(lonSpan(lons), lonSpan(lons.map((lng) => (lng < 0 ? lng + 360 : lng))));
  const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const width = span * Math.cos((midLat * Math.PI) / 180);
  return Math.round(Math.max(width, Math.max(...lats) - Math.min(...lats)) * 100) / 100;
}

async function main() {
  const { features } = JSON.parse(await readFile(bordersFile, 'utf8'));
  const meta = {};

  for (const { properties, geometry } of features) {
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

    const span = spanDegrees(mainPolygon(geometry, properties.label));
    const entry = {
      nameHe: properties.nameHe,
      nameEn: properties.nameEn,
      label: properties.label,
      span,
    };
    if (properties.parent) entry.parent = properties.parent;
    if (landArea(geometry) < SMALL_LAND_AREA) entry.small = true;
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
  console.log(
    `  small (enlarged tap target): ${entries.filter((e) => e.small).length} — ${entries
      .filter((e) => e.small)
      .map((e) => e.nameEn)
      .join(', ')}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
