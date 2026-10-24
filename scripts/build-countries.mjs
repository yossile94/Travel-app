#!/usr/bin/env node
/**
 * Builds the country borders bundled with the app (sprint 0 F-001).
 *
 * Source: Natural Earth admin-0 countries, Israeli point of view, pinned to a
 * fixed commit and verified by SHA-256 so every build produces the same file.
 * The 10m source is ~13 MB; it is simplified with topology preserved (shared
 * borders stay shared, no gaps between neighbours) and reduced to the
 * properties the app needs.
 *
 * Usage: node scripts/build-countries.mjs [--keep=0.05]
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { feature, merge } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, quantile, simplify, sphericalTriangleArea } from 'topojson-simplify';

const SOURCE = {
  // natural-earth-vector v5.1.1
  commit: '9380cca83db5f9aef52d5e762765100745f84b27',
  path: 'geojson/ne_10m_admin_0_countries_isr.geojson',
  // Reviewed on 2026-10-22: 250 features, 13,232,084 bytes (matches GitHub's listing).
  sha256: '45e43bd18bb0d97290ec1751c8b669c7e99a69ca0413b7a0d3196505fc42d4aa',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheFile = join(root, '.cache', 'natural-earth', SOURCE.commit, 'countries_isr.geojson');
// .geojson so Metro ships it as an asset loaded by URL, not compiled into the JS bundle.
const outFile = join(root, 'apps', 'mobile', 'assets', 'geo', 'countries.geojson');

const keepArg = process.argv.find((arg) => arg.startsWith('--keep='));
// Fraction of vertices to keep, ranked by visual importance (topojson-simplify's
// quantile is taken over weights in descending order). Lower = simpler shapes.
const KEEP_FRACTION = keepArg ? Number(keepArg.split('=')[1]) : 0.05;
// ~11 m precision; finer is invisible on a phone-sized globe.
const COORDINATE_DECIMALS = 4;

async function loadSource() {
  let bytes;
  try {
    bytes = await readFile(cacheFile);
  } catch {
    const url = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${SOURCE.commit}/${SOURCE.path}`;
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, bytes);
  }

  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== SOURCE.sha256) {
    throw new Error(
      `SHA-256 mismatch for the Natural Earth source.\n  expected ${SOURCE.sha256}\n  actual   ${hash}\n` +
        'If this is the first download, review the file and pin the actual hash in SOURCE.sha256.',
    );
  }
  return JSON.parse(bytes.toString('utf8'));
}

/** ISO 3166-1 alpha-2. Natural Earth uses "-99" when ISO_A2 is disputed; ISO_A2_EH fills those. */
function countryCode(props) {
  for (const candidate of [props.ISO_A2_EH, props.ISO_A2]) {
    if (typeof candidate === 'string' && /^[A-Z]{2}$/.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Corrections to Natural Earth's localized names, by ADM0_A3. In v5.1.1 the
 * Spratly Islands (PGA, ~114–116°E 10°N) carry the names of Wake Island, an
 * unrelated island in the Pacific.
 */
const NAME_FIXES = {
  PGA: { nameEn: 'Spratly Islands', nameHe: 'איי ספרטלי' },
};

/**
 * The main area of each sovereign state, by SOV_A3: the one whose ADMIN is the
 * sovereign itself (GBR for GB1). Every other area of that state is one of its
 * territories (Gibraltar, Guam, the Cocos Islands...).
 */
function mainAreaBySovereign(features) {
  const main = {};
  for (const { properties: props } of features) {
    if (props.ADMIN === props.SOVEREIGNT) main[props.SOV_A3] = props.ADM0_A3;
  }
  return main;
}

function slimProperties(props, mainBySovereign) {
  const parent = mainBySovereign[props.SOV_A3];
  return {
    code: countryCode(props),
    adm0: props.ADM0_A3,
    nameEn: NAME_FIXES[props.ADM0_A3]?.nameEn ?? props.NAME_EN ?? props.NAME,
    nameHe: NAME_FIXES[props.ADM0_A3]?.nameHe ?? props.NAME_HE ?? null,
    // Natural Earth's label point: inside the country even for odd shapes.
    // Used as the fly-to target and the enlarged tap target for small countries.
    label: [round(props.LABEL_X), round(props.LABEL_Y)],
    // A territory's sovereign, shown next to its name in search results.
    ...(parent && parent !== props.ADM0_A3 ? { parent } : {}),
  };
}

/**
 * Product decision (Yossi, 2026-10-22; spec 5.1): Judea and Samaria are shown
 * as part of Israel, and the Gaza Strip as its own area named "רצועת עזה".
 * In the source both are one feature (ADM0_A3 "PSX") with two polygons. This
 * splits it: the Judea and Samaria polygon is tagged to merge into Israel
 * after simplification (shared border removed, no seam), and Gaza becomes a
 * separate feature without an ISO code, so it is not a selectable destination.
 */
function applyBorderPolicy(features) {
  const psx = features.find((f) => f.properties.ADM0_A3 === 'PSX');
  const israel = features.find((f) => f.properties.ADM0_A3 === 'ISR');
  if (
    !psx ||
    !israel ||
    psx.geometry.type !== 'MultiPolygon' ||
    psx.geometry.coordinates.length !== 2
  ) {
    throw new Error('Unexpected PSX/ISR structure in the source; review the border policy.');
  }

  // Gaza lies entirely west of 34.7°E; Judea and Samaria entirely east of it.
  const isGaza = (polygon) => polygon[0].every(([lng]) => lng < 34.7);
  const gaza = psx.geometry.coordinates.filter(isGaza);
  const judeaSamaria = psx.geometry.coordinates.filter((polygon) => !isGaza(polygon));
  if (gaza.length !== 1 || judeaSamaria.length !== 1) {
    throw new Error('Could not tell Gaza from Judea and Samaria in the PSX feature.');
  }

  const mainBySovereign = mainAreaBySovereign(features);
  return features.flatMap((f) => {
    if (f !== psx) return [{ ...f, properties: slimProperties(f.properties, mainBySovereign) }];
    return [
      {
        type: 'Feature',
        properties: { ...slimProperties(israel.properties, mainBySovereign), mergeInto: 'ISR' },
        geometry: { type: 'Polygon', coordinates: judeaSamaria[0] },
      },
      {
        type: 'Feature',
        properties: {
          code: null,
          adm0: 'GAZ',
          nameEn: 'Gaza Strip',
          nameHe: 'רצועת עזה',
          label: [34.39, 31.42],
        },
        geometry: { type: 'Polygon', coordinates: gaza[0] },
      },
    ];
  });
}

function round(value) {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

// Countries smaller than this (in approximateArea units) keep every vertex.
const smallArg = process.argv.find((arg) => arg.startsWith('--small='));
const SMALL_COUNTRY_AREA = smallArg ? Number(smallArg.split('=')[1]) : 0.05;

/** Gives every vertex of a small country infinite weight so simplify() keeps it. */
function protectSmallCountries(topo, sourceFeatures) {
  const geometries = topo.objects.countries.geometries;
  let count = 0;
  geometries.forEach((geometry, i) => {
    if (approximateArea(sourceFeatures[i].geometry) >= SMALL_COUNTRY_AREA) return;
    count++;
    for (const arcIndex of arcIndexes(geometry.arcs)) {
      for (const point of topo.arcs[arcIndex]) point[2] = Infinity;
    }
  });
  return count;
}

/** Flattens TopoJSON's nested arc references; negative values (~i) mean arc i reversed. */
function arcIndexes(arcs) {
  if (!arcs) return [];
  return arcs.flatMap((item) =>
    Array.isArray(item) ? arcIndexes(item) : [item < 0 ? ~item : item],
  );
}

/** Rough area in square degrees, scaled by latitude. Only used to compare a shape with itself. */
function approximateArea(geometry) {
  if (!geometry) return 0;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const [outer, ...holes] of polygons) {
    total += ringArea(outer) - holes.reduce((sum, hole) => sum + ringArea(hole), 0);
  }
  return total;
}

function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    sum += (x2 - x1) * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
  }
  return Math.abs(sum / 2);
}

function roundCoordinates(coordinates) {
  return typeof coordinates[0] === 'number'
    ? coordinates.map(round)
    : coordinates.map(roundCoordinates);
}

async function main() {
  const source = await loadSource();

  const prepared = applyBorderPolicy(source.features);

  const topo = presimplify(
    topology({ countries: { type: 'FeatureCollection', features: prepared } }, 1e6),
    sphericalTriangleArea,
  );
  // Without this, a single global threshold erases microstates (Vatican,
  // Monaco, ...) entirely: every one of their triangles is "small".
  const protectedCount = protectSmallCountries(topo, prepared);
  const simplified = simplify(topo, quantile(topo, KEEP_FRACTION));

  const geometries = simplified.objects.countries.geometries;
  const result = {
    type: 'FeatureCollection',
    features: geometries
      .filter((g) => !g.properties.mergeInto)
      .map((g) => {
        const partners = geometries.filter((p) => p.properties.mergeInto === g.properties.adm0);
        if (partners.length === 0) return feature(simplified, g);
        // merge() unions polygons that share arcs, dropping the shared border.
        return {
          type: 'Feature',
          properties: g.properties,
          geometry: merge(simplified, [g, ...partners]),
        };
      }),
  };

  for (const f of result.features) {
    if (f.geometry) f.geometry.coordinates = roundCoordinates(f.geometry.coordinates);
  }

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(result));

  const { size } = await stat(outFile);
  const missingCode = result.features.filter((f) => !f.properties.code);
  const missingHebrew = result.features.filter((f) => !f.properties.nameHe);
  const missingGeometry = result.features.filter((f) => !f.geometry);

  console.log(`Wrote ${outFile}`);
  console.log(`  features: ${result.features.length}, size: ${(size / 1024).toFixed(0)} KB`);
  console.log(
    `  vertices kept: ${(KEEP_FRACTION * 100).toFixed(1)}%, small countries kept whole: ${protectedCount}`,
  );
  console.log(
    `  without ISO code (${missingCode.length}): ${missingCode.map((f) => f.properties.nameEn).join(', ')}`,
  );
  console.log(
    `  without Hebrew name (${missingHebrew.length}): ${missingHebrew.map((f) => f.properties.nameEn).join(', ')}`,
  );
  console.log(
    `  without geometry after simplify (${missingGeometry.length}): ${missingGeometry.map((f) => f.properties.nameEn).join(', ')}`,
  );

  // Quality check: how much did simplification change each country's area?
  const areaBefore = new Map();
  for (const f of prepared) {
    const key = f.properties.mergeInto ?? f.properties.adm0;
    areaBefore.set(key, (areaBefore.get(key) ?? 0) + approximateArea(f.geometry));
  }
  const drift = result.features
    .map((f) => {
      const before = areaBefore.get(f.properties.adm0) ?? 0;
      const after = approximateArea(f.geometry);
      return { name: f.properties.nameEn, change: before ? Math.abs(after - before) / before : 0 };
    })
    .sort((a, b) => b.change - a.change);
  const worst = drift.slice(0, 8).map((d) => `${d.name} ${(d.change * 100).toFixed(1)}%`);
  console.log(`  largest area change: ${worst.join(', ')}`);
  console.log(
    `  countries changed by more than 10%: ${drift.filter((d) => d.change > 0.1).length}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
