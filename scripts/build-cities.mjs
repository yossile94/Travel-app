/**
 * Builds the bundled city list for the trip form (sprint 3 F-008, AC-4;
 * ADR-007 section 4). Source: GeoNames cities15000 and the Hebrew rows of
 * alternateNamesV2, CC BY 4.0 (credited in the app's "Sources" sheet).
 *
 * Each city is assigned to the globe's area (adm0) by point in polygon on
 * countries-detailed.geojson, with up to 10 km to the nearest polygon for
 * coastal points. Cities in areas that can't be selected (Gaza, bases) are
 * left out. Output: apps/mobile/assets/data/cities.dat (JSON text, loaded
 * as an asset only when the city search opens).
 *
 * The downloads are manual (see the README in .cache/geonames): put
 * cities15000.txt and alternateNames-he.txt (alternateNamesV2.txt filtered to
 * isolanguage "he") in .cache/geonames/<date>/, then:
 *   node scripts/build-cities.mjs --cache=.cache/geonames/2026-10-26
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheArg = process.argv.find((arg) => arg.startsWith('--cache='));
const cacheDir = join(root, cacheArg ? cacheArg.split('=')[1] : '.cache/geonames/2026-10-26');
const outDir = join(root, 'apps', 'mobile', 'assets', 'data');
const outFile = join(outDir, 'cities.dat');

/** Names longer than this break the trip_cities check (sprint 3 design 5.2, Raz): the build fails. */
export const NAME_MAX = 60;
/** A coastal city may sit just outside its simplified polygon. */
const NEAREST_KM = 10;

// --------------------------------------------------------------- geometry

const ringsOf = (geometry) =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

/** Even-odd ray casting on one ring of [lon, lat] points. */
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring and outside every hole, of any part. */
export function inGeometry(point, geometry) {
  return ringsOf(geometry).some(
    ([outer, ...holes]) => inRing(point, outer) && !holes.some((hole) => inRing(point, hole)),
  );
}

/** Distance in km from a point to a segment, on a local equirectangular plane. */
function segmentKm([px, py], [ax, ay], [bx, by]) {
  const k = Math.cos((py * Math.PI) / 180) * 111.32;
  const [x, y, x1, y1, x2, y2] = [px * k, py * 110.57, ax * k, ay * 110.57, bx * k, by * 110.57];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t =
    dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

export function distanceKm(point, geometry) {
  let best = Infinity;
  for (const polygon of ringsOf(geometry)) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++)
        best = Math.min(best, segmentKm(point, ring[i - 1], ring[i]));
    }
  }
  return best;
}

function bboxOf(geometry) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of ringsOf(geometry)) {
    for (const [x, y] of polygon[0]) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  }
  return box;
}

const inBox = ([x, y], [x0, y0, x1, y1], pad = 0) =>
  x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad;

const inBoxXY = ([x, y], [x0, y0, x1, y1], padX, padY) =>
  x >= x0 - padX && x <= x1 + padX && y >= y0 - padY && y <= y1 + padY;

/**
 * The area of a point: the polygon that contains it, else the nearest one
 * within 10 km. null for open sea; { adm0: null } for an area that can't be
 * selected (no country code), so its cities are left out.
 */
export function areaOf(point, areas) {
  for (const area of areas) {
    if (inBox(point, area.box) && inGeometry(point, area.geometry)) return area;
  }
  let best = null;
  let bestKm = NEAREST_KM;
  for (const area of areas) {
    // 10 km in degrees: longitude degrees shrink towards the poles (Raz, m10).
    const lat = Math.min(Math.abs(point[1]), 85);
    const padX = NEAREST_KM / (111.32 * Math.cos((lat * Math.PI) / 180));
    if (!inBoxXY(point, area.box, padX, NEAREST_KM / 110.57)) continue;
    const km = distanceKm(point, area.geometry);
    if (km <= bestKm) {
      best = area;
      bestKm = km;
    }
  }
  return best;
}

// ------------------------------------------------------------------ names

/**
 * The characters the server's text_is_clean refuses (and the app's
 * isForbidden): controls, bidi marks and isolates, zero-width, BOM, line
 * separators. GeoNames has a few names with an RLM in them (Raz, M1).
 */
export function isForbidden(cp) {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0x61c ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) ||
    cp === 0xfeff
  );
}

/** A name as the database will accept it: no forbidden characters, trimmed. */
export function cleanName(name) {
  return [...name]
    .filter((ch) => !isForbidden(ch.codePointAt(0)))
    .join('')
    .trim();
}

const HEBREW = /[\u05d0-\u05ea]/;
const NIQQUD = /[\u0591-\u05c7]/;

/**
 * The Hebrew name of each city (sprint 3 design 5.3): the preferred one, not
 * historic or colloquial, without niqqud; else the first plain one.
 */
export function hebrewNames(lines) {
  const best = new Map();
  for (const line of lines) {
    const [, id, lang, name, preferred, short, colloquial, historic] = line.split('\t');
    if (lang !== 'he' || !name || historic === '1' || colloquial === '1') continue;
    if (!HEBREW.test(name) || NIQQUD.test(name)) continue;
    const score = (preferred === '1' ? 2 : 0) + (short === '1' ? 1 : 0);
    const current = best.get(id);
    const clean = cleanName(name);
    if (clean && (!current || score > current.score)) best.set(id, { name: clean, score });
  }
  return new Map([...best].map(([id, { name }]) => [id, name]));
}

// ------------------------------------------------------------------ build

async function main() {
  const countries = JSON.parse(
    await readFile(
      join(root, 'apps', 'mobile', 'assets', 'geo', 'countries-detailed.geojson'),
      'utf8',
    ),
  );
  const areas = countries.features
    // Antarctica's outline feature is a line copy; only areas count.
    .filter((f) => !f.properties.outline)
    .map((f) => ({
      adm0: f.properties.code ? f.properties.adm0 : null,
      geometry: f.geometry,
      box: bboxOf(f.geometry),
    }));

  const citiesText = await readFile(join(cacheDir, 'cities15000.txt'), 'utf8');
  const heText = await readFile(join(cacheDir, 'alternateNames-he.txt'), 'utf8');
  const he = hebrewNames(heText.split('\n'));

  const byArea = new Map();
  const tooLong = [];
  let dropped = 0;
  let sea = 0;
  for (const line of citiesText.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    const [id, name, ascii] = [c[0], cleanName(c[1]), cleanName(c[2])];
    const point = [Number(c[5]), Number(c[4])];
    const population = Number(c[14]) || 0;
    const area = areaOf(point, areas);
    if (!area) {
      sea += 1;
      continue;
    }
    if (!area.adm0) {
      dropped += 1;
      continue;
    }
    const nameHe = he.get(id) ?? '';
    for (const n of [name, nameHe]) if ([...n].length > NAME_MAX) tooLong.push(`${id} ${n}`);
    if (!name) throw new Error(`city ${id} has no name left after cleaning`);
    const list = byArea.get(area.adm0) ?? [];
    // [id, Hebrew name or "", English name, ASCII name if different, population].
    // No coordinates: the climate file maps cities to cells at build time.
    list.push([Number(id), nameHe, name, ascii === name ? '' : ascii, population]);
    byArea.set(area.adm0, list);
  }
  if (tooLong.length) {
    throw new Error(
      `city names over ${NAME_MAX} characters (trip_cities check):\n${tooLong.join('\n')}`,
    );
  }
  for (const list of byArea.values()) list.sort((a, b) => b[4] - a[4]);

  const sha = createHash('sha256').update(citiesText).digest('hex');
  const output = {
    format: 'travel-app-cities',
    version: 1,
    source: {
      name: 'GeoNames cities15000 + alternateNamesV2 (he)',
      licence: 'CC BY 4.0',
      url: 'https://download.geonames.org/export/dump/',
      cities15000Sha256: sha,
    },
    columns: ['id', 'nameHe', 'nameEn', 'ascii', 'population'],
    areas: Object.fromEntries([...byArea].sort(([a], [b]) => a.localeCompare(b))),
  };
  await mkdir(outDir, { recursive: true });
  const text = JSON.stringify(output);
  await writeFile(outFile, text);
  const total = [...byArea.values()].reduce((n, list) => n + list.length, 0);
  const withHe = [...byArea.values()].flat().filter((c) => c[1]).length;
  console.log(
    `cities: ${total} in ${byArea.size} areas (${withHe} with a Hebrew name), ` +
      `${dropped} in areas that can't be selected, ${sea} at sea; ${(text.length / 1024).toFixed(0)} KB`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
