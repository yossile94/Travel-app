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
 * .cache/cru/, and (sprint 9) the same three .wet.dat.gz for wet days, then:
 *   node scripts/build-climate.mjs
 *
 * Version 2 (sprint 9, discovery search 5.12): "wet" holds the wet-day
 * normals of the same slots, in whole days (one byte each, 0-31), 255 where a
 * slot has none (a city's own normals). The rules are in whole days (Raz, D1).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createGunzip, gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cruDir = join(root, '.cache', 'cru');
const geoDir = join(root, '.cache', 'geonames', '2026-10-26');
const dataDir = join(root, 'apps', 'mobile', 'assets', 'data');

export const DECADES = ['1991.2000', '2001.2010', '2011.2020'];
/**
 * The files this build was reviewed with (Dudi, t2). Record: CRU TS v4.08,
 * Harris, I., Osborn, T.J., Jones, P. et al. (2020) Version 4 of the CRU TS
 * monthly high-resolution gridded multivariate climate dataset, Scientific
 * Data 7, 109, doi:10.1038/s41597-020-0453-3; downloaded from CEDA on
 * 2026-10-26. A new release updates these on purpose.
 */
const SOURCE_SHA256 = {
  'cru_ts4.08.1991.2000.tmp.dat.gz':
    '2f05209d462b78dbaedab523e090b38401f675d85ef51869ffb213dbf2f36ff8',
  'cru_ts4.08.2001.2010.tmp.dat.gz':
    'b1b995d1af13ea90cf3a43d1f410faa6ca42ba2517db7c1b7a2468fa0d3d2fad',
  'cru_ts4.08.2011.2020.tmp.dat.gz':
    '149f5a32ccd9e285e43bfbeb355894d40ba9b019eec01017a6cf54878d8a0354',
  // Sprint 9: wet-day frequency, downloaded from CEDA on 2026-10-28.
  'cru_ts4.08.1991.2000.wet.dat.gz':
    '07e57482afdadf4fb67d49d4a1e6a9fb2b81a4469d9279989175002063ac7b93',
  'cru_ts4.08.2001.2010.wet.dat.gz':
    '9f3e899f1f4be46cb5ea45e4efa894acd42fda82107710e19bf6f78e3b89e7c3',
  'cru_ts4.08.2011.2020.wet.dat.gz':
    'cba4722b55c7747cc8c274cd604a8e994daa951bb763b5d488504463afe80da8',
};
/** No wet-day value for a slot. */
export const NO_WET = 255;
const COLS = 720;
const ROWS = 360;
const CELLS = COLS * ROWS;
const MISSING = -999;
/**
 * Capitals GeoNames doesn't mark PPLC (AC-10's exceptions table): the
 * climate point's city where the data has no capital in the area.
 */
export const CAPITALS = { ISR: 281184 /* Jerusalem (PPLA in GeoNames) */ };

/**
 * Sea-level cities whose 0.5 degree cell is mostly mountain, so the cell's
 * mean is far colder than the city (Raz, T1). Published 1991-2020 monthly
 * means, January first, in degrees; each with its source. To be checked
 * against the Israel Meteorological Service before launch (pre-launch list).
 */
export const CITY_NORMALS = {
  295277: {
    name: 'Eilat',
    months: [16.1, 17.8, 21, 25.2, 29.4, 32.4, 34, 34, 31.8, 28.1, 22.5, 17.6],
    source: 'climieviaggi.it/clima/israele/eilat, "Temperature medie (1991-2020)"',
  },
};

/** Pearson correlation of two 12-month series. */
function correlation(a, b) {
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 1;
}

/**
 * Cells whose year doesn't follow their neighbours': where the neighbours
 * swing by 6 degrees or more over the year and the cell's curve doesn't go
 * with theirs (correlation under 0.5). CRU's Dead Sea cell is one: about
 * 16-20 degrees all year (found in QA: Arad and Dimona came out warmer in
 * January than in July). Such a cell counts as having no value.
 */
export function anomalousCells(normals) {
  const out = new Set();
  for (const [cell, months] of normals) {
    const row = Math.floor(cell / COLS);
    const col = cell % COLS;
    const around = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const r = row + dr;
        if (r < 0 || r >= ROWS) continue;
        const n = normals.get(r * COLS + ((col + dc + COLS) % COLS));
        if (n) around.push(n);
      }
    }
    if (around.length < 3) continue;
    const median = months.map((_, m) => {
      const v = around.map((n) => n[m]).sort((x, y) => x - y);
      return v[Math.floor(v.length / 2)];
    });
    const swing = Math.max(...median) - Math.min(...median);
    if (swing >= 600 && correlation(months, median) < 0.5) out.add(cell);
  }
  return out;
}

/** The grid's rows run from the south (-89.75) to the north; [lon, lat] in. */
export function cellOf([lon, lat]) {
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor((lat + 90) / 0.5)));
  const col = Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) / 0.5)));
  return row * COLS + col;
}

/**
 * Monthly normals per cell from the decade files: tmp comes in tenths of a
 * degree (x10 gives hundredths), wet in hundredths of a day (x1).
 */
async function readNormals(files, factor = 10) {
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
      // Number('') is 0, not NaN: a short line would read as zeros (Dudi, t1).
      if (line.length !== COLS * 8) throw new Error(`${file}: line ${n} is ${line.length} long`);
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
    const name = file.split(/[\\/]/).pop();
    hashes[name] = hash.digest('hex');
    if (SOURCE_SHA256[name] !== hashes[name]) {
      throw new Error(`${name}: not the file this build was checked against (sha256)`);
    }
  }
  // A month counts only with all 30 years; a cell only with all 12 months.
  const normals = new Map();
  for (let cell = 0; cell < CELLS; cell++) {
    const months = [];
    for (let m = 0; m < 12; m++) {
      const i = cell * 12 + m;
      if (count[i] !== 30) break;
      // Tenths in the file, hundredths out: the only rounding before the display.
      months.push(Math.round((sum[i] / 30) * factor));
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
  const wet = await readNormals(
    DECADES.map((d) => join(cruDir, `cru_ts4.08.${d}.wet.dat.gz`)),
    1,
  );
  Object.assign(hashes, wet.hashes);
  const anomalous = anomalousCells(normals);
  for (const cell of anomalous) normals.delete(cell);
  const cities = await readJson('apps', 'mobile', 'assets', 'data', 'cities.dat');
  const meta = await readJson('apps', 'mobile', 'src', 'features', 'globe', 'countryMeta.json');
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
  // The wet-day normals of the same slots; null when there are none (Raz, sprint 9).
  const wetOut = [];
  const slotOf = (cell) => {
    if (!slots.has(cell)) {
      slots.set(cell, cellsOut.length);
      cellsOut.push(normals.get(cell));
      wetOut.push(wet.normals.get(cell) ?? null);
    }
    return slots.get(cell);
  };

  // Every bundled city with a value, sorted by id.
  const cityPairs = [];
  const cityIndex = new Map();
  for (const [adm0, list] of Object.entries(cities.areas)) {
    for (const [id, nameHe, nameEn] of list) {
      cityIndex.set(id, { adm0, nameHe, nameEn });
      if (CITY_NORMALS[id]) {
        cityPairs.push([id, cellsOut.length]);
        cellsOut.push(CITY_NORMALS[id].months.map((v) => Math.round(v * 100)));
        wetOut.push(null);
        continue;
      }
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
    // The city list already put each city in its area: inside the polygon or
    // within 10 km of it. Coastal capitals (Nuuk, Colombo, Monrovia) sit just
    // outside the simplified polygons; the polygon alone dropped them and
    // Greenland took its value from the ice cap (Dudi, T1).
    const usable = (id) => cityIndex.get(id)?.adm0 === adm0 && point.has(id);
    // Candidates in AC-10's order; the first with a value wins (Raz, T4).
    const candidates = [];
    if (info.city) {
      const match = (cities.areas[adm0] ?? []).find(
        (c) => c[1] === info.city || c[2] === info.city,
      );
      if (match && usable(match[0])) candidates.push(match[0]);
    }
    if (usable(CAPITALS[adm0])) candidates.push(CAPITALS[adm0]);
    const capital = capitals.filter(([id]) => usable(id)).sort((x, y) => y[1] - x[1])[0];
    if (capital) candidates.push(capital[0]);
    candidates.push(0); // the label point
    let chosen = null;
    for (const cityId of candidates) {
      const cell = CITY_NORMALS[cityId]
        ? null
        : valueCell(cellOf(cityId ? point.get(cityId) : info.label), normals);
      // A city with its own normals has a wrong cell: the next candidate is used.
      if (cell !== null) {
        chosen = { cityId, cell };
        break;
      }
    }
    if (!chosen) {
      noValue.push(adm0);
      continue;
    }
    const c = chosen.cityId ? cityIndex.get(chosen.cityId) : null;
    areaOut[adm0] = c
      ? [slotOf(chosen.cell), chosen.cityId, c.nameHe, c.nameEn]
      : [slotOf(chosen.cell), 0, '', ''];
  }

  const bytes = Buffer.alloc(cellsOut.length * 12 * 2);
  cellsOut.forEach((months, s) =>
    months.forEach((v, m) => bytes.writeInt16LE(v, (s * 12 + m) * 2)),
  );
  const wetBytes = Buffer.alloc(wetOut.length * 12);
  wetOut.forEach((months, s) => {
    // Hundredths of a day in, whole days out.
    for (let m = 0; m < 12; m++)
      wetBytes[s * 12 + m] = months ? Math.round(months[m] / 100) : NO_WET;
  });
  let last = 0;
  const output = {
    format: 'travel-app-climate',
    version: 2,
    source: {
      name: 'CRU TS v4.08 tmp and wet (CEDA), 1991-2020 monthly means',
      licence: 'Open Government Licence v3.0',
      url: 'https://data.ceda.ac.uk/badc/cru/data/cru_ts/cru_ts_4.08/data/tmp',
      sha256: hashes,
      cityNormals: Object.fromEntries(
        Object.entries(CITY_NORMALS).map(([id, c]) => [id, `${c.name}: ${c.source}`]),
      ),
      anomalousCells: [...anomalous].sort((a, b) => a - b),
    },
    scale: 100,
    cells: bytes.toString('base64'),
    wet: wetBytes.toString('base64'),
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
    `climate: ${cellsOut.length} cells (${anomalous.size} anomalous dropped), ${cityPairs.length} cities, ` +
      `${Object.keys(areaOut).length} areas (no value: ${noValue.join(' ') || 'none'}); ` +
      `${(json.length / 1024).toFixed(0)} KB, ${(gzipSync(json).length / 1024).toFixed(0)} KB gzip`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
