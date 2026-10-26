/**
 * Builds the bundled climate normals for the temperature fields (sprint 3
 * F-011, AC-10 to AC-12; ADR-007; design section 2). Source: CRU TS v4.08
 * mean temperature (tmp), from CEDA under the Open Government Licence v3.0
 * (credited in the app's "Sources" sheet). Not the copy on the CRU site,
 * which is ODbL.
 *
 * The normal of a month is the mean of its 30 values, 1991 to 2020, in the
 * 0.5 degree cell that holds the point. A cell with no value (sea next to the
 * coast) falls back to the nearest cell with one, one ring out, then two.
 * Values are kept in hundredths of a degree (int16), so the app rounds once.
 *
 * Output: apps/mobile/assets/data/climate.dat (JSON text, loaded only after
 * the first frame):
 *   cells   base64 of int16 LE, 12 months per cell (each cell kept once)
 *   cities  flat [id delta, cell index, ...] for every bundled city with a value
 *   areas   { adm0: [cell index, cityId or 0, nameHe, nameEn] }: the area's climate point
 *   noValue the areas with no value (the field is hidden), locked by a test
 *
 * The downloads are manual and need a free CEDA account (ADR-007): put the
 * three decade files cru_ts4.08.<1991.2000|2001.2010|2011.2020>.tmp.dat.gz in
 * .cache/cru/, then:  node scripts/build-climate.mjs
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createGunzip, gzipSync } from 'node:zlib';

import { bboxOf, inGeometry } from './build-cities.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cruDir = join(root, '.cache', 'cru');
const geoDir = join(root, '.cache', 'geonames', '2026-10-26');
const dataDir = join(root, 'apps', 'mobile', 'assets', 'data');

export const DECADES = ['1991.2000', '2001.2010', '2011.2020'];
const COLS = 720;
const ROWS = 360;
const CELLS = COLS * ROWS;
const MISSING = -999;
/**
 * Capitals GeoNames doesn't mark PPLC (AC-10's exceptions table): the
 * climate point's city where the data has no capital in the area.
 */
export const CAPITALS = { ISR: 281184 /* Jerusalem (PPLA in GeoNames) */ };

/** The grid's rows run from the south (-89.75) to the north; [lon, lat] in. */
export function cellOf([lon, lat]) {
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor((lat + 90) / 0.5)));
  const col = Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) / 0.5)));
  return row * COLS + col;
}

/** Monthly normals per cell, in hundredths of a degree, from the decade files (tenths). */
async function readNormals(files) {
  const sum = new Float64Array(CELLS * 12);
  const count = new Uint8Array(CELLS * 12);
  const hashes = {};
  for (const file of files) {
    const hash = createHash('sha256');
    const input = createReadStream(file);
    input.on('data', (chunk) => hash.update(chunk));
    const lines = createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
    let n = 0;
    for await (const line of lines) {
      const month = Math.floor(n / ROWS) % 12;
      const row = n % ROWS;
      for (let col = 0; col < COLS; col++) {
        const v = Number(line.slice(col * 8, col * 8 + 8));
        if (v === MISSING || Number.isNaN(v)) continue;
        const i = (row * COLS + col) * 12 + month;
        sum[i] += v;
        count[i] += 1;
      }
      n++;
    }
    if (n !== 120 * ROWS) throw new Error(`${file}: ${n} rows, expected ${120 * ROWS}`);
    hashes[file.split(/[\\/]/).pop()] = hash.digest('hex');
  }
  // A month counts only with all 30 years; a cell only with all 12 months.
  const normals = new Map();
  for (let cell = 0; cell < CELLS; cell++) {
    const months = [];
    for (let m = 0; m < 12; m++) {
      const i = cell * 12 + m;
      if (count[i] !== 30) break;
      // Tenths in the file, hundredths out: the only rounding before the display.
      months.push(Math.round((sum[i] / 30) * 10));
    }
    if (months.length === 12) normals.set(cell, months);
  }
  return { normals, hashes };
}

/** The cell with a value nearest to the point's cell: itself, then one ring out, then two. */
export function valueCell(cell, normals) {
  if (normals.has(cell)) return cell;
  const row = Math.floor(cell / COLS);
  const col = cell % COLS;
  for (let ring = 1; ring <= 2; ring++) {
    let best = null;
    let bestD = Infinity;
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = row + dr;
        if (r < 0 || r >= ROWS) continue;
        const candidate = r * COLS + ((col + dc + COLS) % COLS);
        const d = dr * dr + dc * dc;
        if (normals.has(candidate) && d < bestD) {
          best = candidate;
          bestD = d;
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

const readJson = async (...path) => JSON.parse(await readFile(join(root, ...path), 'utf8'));

async function main() {
  const { normals, hashes } = await readNormals(
    DECADES.map((d) => join(cruDir, `cru_ts4.08.${d}.tmp.dat.gz`)),
  );
  const cities = await readJson('apps', 'mobile', 'assets', 'data', 'cities.dat');
  const meta = await readJson('apps', 'mobile', 'src', 'features', 'globe', 'countryMeta.json');
  const countries = await readJson('apps', 'mobile', 'assets', 'geo', 'countries-detailed.geojson');
  const geometryOf = new Map();
  for (const f of countries.features) {
    if (f.properties.outline || !f.properties.code) continue;
    const list = geometryOf.get(f.properties.adm0) ?? [];
    list.push({ geometry: f.geometry, box: bboxOf(f.geometry) });
    geometryOf.set(f.properties.adm0, list);
  }
  const insideArea = (adm0, [x, y]) =>
    (geometryOf.get(adm0) ?? []).some(
      ({ geometry, box: [x0, y0, x1, y1] }) =>
        x >= x0 && x <= x1 && y >= y0 && y <= y1 && inGeometry([x, y], geometry),
    );

  // Coordinates and capitals from cities15000 (the bundled list has no coordinates).
  const point = new Map();
  const capitals = [];
  const text = await readFile(join(geoDir, 'cities15000.txt'), 'utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    point.set(Number(c[0]), [Number(c[5]), Number(c[4])]);
    if (c[7] === 'PPLC') capitals.push([Number(c[0]), Number(c[14]) || 0]);
  }

  const slots = new Map();
  const cellsOut = [];
  const slotOf = (cell) => {
    if (!slots.has(cell)) {
      slots.set(cell, cellsOut.length);
      cellsOut.push(normals.get(cell));
    }
    return slots.get(cell);
  };

  // Every bundled city with a value, sorted by id.
  const cityPairs = [];
  const cityIndex = new Map();
  for (const [adm0, list] of Object.entries(cities.areas)) {
    for (const [id, nameHe, nameEn] of list) {
      cityIndex.set(id, { adm0, nameHe, nameEn });
      const p = point.get(id);
      const cell = p ? valueCell(cellOf(p), normals) : null;
      if (cell !== null) cityPairs.push([id, slotOf(cell)]);
    }
  }
  cityPairs.sort((a, b) => a[0] - b[0]);

  // The area's climate point (AC-10): the local-time city, the capital, the label point.
  // A city counts only inside the area's polygon.
  const areaOut = {};
  const noValue = [];
  for (const [adm0, info] of Object.entries(meta)) {
    const usable = (id) =>
      cityIndex.get(id)?.adm0 === adm0 && point.has(id) && insideArea(adm0, point.get(id));
    let cityId = 0;
    if (info.city) {
      const match = (cities.areas[adm0] ?? []).find(
        (c) => c[1] === info.city || c[2] === info.city,
      );
      if (match && usable(match[0])) cityId = match[0];
    }
    if (!cityId && usable(CAPITALS[adm0])) cityId = CAPITALS[adm0];
    if (!cityId) {
      const capital = capitals.filter(([id]) => usable(id)).sort((a, b) => b[1] - a[1])[0];
      if (capital) cityId = capital[0];
    }
    const cell = valueCell(cellOf(cityId ? point.get(cityId) : info.label), normals);
    if (cell === null) {
      noValue.push(adm0);
      continue;
    }
    const c = cityId ? cityIndex.get(cityId) : null;
    areaOut[adm0] = c ? [slotOf(cell), cityId, c.nameHe, c.nameEn] : [slotOf(cell), 0, '', ''];
  }

  const bytes = Buffer.alloc(cellsOut.length * 12 * 2);
  cellsOut.forEach((months, s) =>
    months.forEach((v, m) => bytes.writeInt16LE(v, (s * 12 + m) * 2)),
  );
  let last = 0;
  const output = {
    format: 'travel-app-climate',
    version: 1,
    source: {
      name: 'CRU TS v4.08 tmp (CEDA), 1991-2020 monthly means',
      licence: 'Open Government Licence v3.0',
      url: 'https://data.ceda.ac.uk/badc/cru/data/cru_ts/cru_ts_4.08/data/tmp',
      sha256: hashes,
    },
    scale: 100,
    cells: bytes.toString('base64'),
    // Ids as deltas from the previous one: smaller, and they compress well.
    cities: cityPairs.flatMap(([id, slot]) => {
      const delta = id - last;
      last = id;
      return [delta, slot];
    }),
    areas: areaOut,
    noValue: noValue.sort(),
  };
  const json = JSON.stringify(output);
  await writeFile(join(dataDir, 'climate.dat'), json);
  console.log(
    `climate: ${cellsOut.length} cells, ${cityPairs.length} cities, ` +
      `${Object.keys(areaOut).length} areas (no value: ${noValue.join(' ') || 'none'}); ` +
      `${(json.length / 1024).toFixed(0)} KB, ${(gzipSync(json).length / 1024).toFixed(0)} KB gzip`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
