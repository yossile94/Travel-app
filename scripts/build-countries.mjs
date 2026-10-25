#!/usr/bin/env node
/**
 * Builds the country borders bundled with the app (sprint 0 F-001), at two
 * levels of detail, and the ocean mask that tints the sea (sprint 1 F-001.1):
 *
 * - countries.geojson: "coarse", KEEP_FRACTION of the vertices, shown up to zoom 3.
 * - countries-detailed.geojson: "detailed", DETAIL_KEEP_FRACTION, from zoom 3,
 *   loaded only after the globe is ready (AC-13a, design 6.5).
 * - ocean-mask.geojson: the whole world minus the coarse land and the
 *   Antarctic ice shelves, so the tint's coastline matches the borders
 *   (AC-8, design 6.2) and the ice is never tinted as sea.
 *
 * Natural Earth cuts areas that cross the 180° meridian (Russia, Fiji, the
 * US...) into pieces at ±180°. Drawn on the globe, the cut is a straight line
 * through the land, so those pieces are joined again, with longitudes past
 * 180°. Antarctica, which surrounds the pole, can't be joined: its outline
 * is added as a line feature ({ outline: true }) without the cut, and the app
 * draws Antarctica's lines from that feature (sprint 1 QA).
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

import polygonClipping from 'polygon-clipping';
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

// Same Natural Earth version. Reviewed on 2026-10-25: 561,580 bytes.
const ICE_SHELVES = {
  path: 'geojson/ne_10m_antarctic_ice_shelves_polys.geojson',
  sha256: '8f9bf62368695f5664b5fcd9bc0e2baea66da295aea014ce0e9cf510f209898d',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache', 'natural-earth', SOURCE.commit);
// .geojson so Metro ships these as assets loaded by URL, not compiled into the JS bundle.
const geoDir = join(root, 'apps', 'mobile', 'assets', 'geo');
const outFile = join(geoDir, 'countries.geojson');
const detailedFile = join(geoDir, 'countries-detailed.geojson');
const oceanFile = join(geoDir, 'ocean-mask.geojson');

const keepArg = process.argv.find((arg) => arg.startsWith('--keep='));
// Fraction of vertices to keep, ranked by visual importance (topojson-simplify's
// quantile is taken over weights in descending order). Lower = simpler shapes.
const KEEP_FRACTION = keepArg ? Number(keepArg.split('=')[1]) : 0.05;
// Detailed level (sprint 1 AC-13a): tuned against the 5 MB budget for this
// file plus the ocean mask, and against the A73 screenshot at zoom 6.
const detailArg = process.argv.find((arg) => arg.startsWith('--detail-keep='));
const DETAIL_KEEP_FRACTION = detailArg ? Number(detailArg.split('=')[1]) : 0.25;
// ~11 m precision; finer is invisible on a phone-sized globe.
const COORDINATE_DECIMALS = 4;

/** A Natural Earth file at the pinned commit, from the cache or GitHub, verified by SHA-256. */
async function loadSource({ path, sha256 } = SOURCE) {
  const cacheFile = join(cacheDir, path.split('/').pop());
  let bytes;
  try {
    bytes = await readFile(cacheFile);
  } catch {
    const url = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${SOURCE.commit}/${path}`;
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, bytes);
  }

  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== sha256) {
    throw new Error(
      `SHA-256 mismatch for ${path}.\n  expected ${sha256}\n  actual   ${hash}\n` +
        'If this is the first download, review the file and pin the actual hash.',
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

/** One feature per area at a simplification level; Judea and Samaria merged into Israel. */
function countriesAt(simplified) {
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
    if (f.geometry && f.properties.adm0 === 'ATA') {
      f.geometry.coordinates = polygonsOf(f.geometry).map(([outer, ...holes]) => [
        closeAroundSouthPole(outer),
        ...holes,
      ]);
      if (f.geometry.type === 'Polygon') f.geometry.coordinates = f.geometry.coordinates[0];
    }
    const original = f.geometry;
    if (f.geometry) f.geometry = joinAcrossAntimeridian(f.geometry, f.properties.adm0);
    if (f.geometry) f.geometry.coordinates = roundCoordinates(f.geometry.coordinates);
    // A joined area reaches past 180°; its bbox from the cut pieces would be wrong.
    if (f.geometry && f.geometry !== original) f.bbox = boundingBox(f.geometry);
  }
  const antarctica = result.features.find((f) => f.properties.adm0 === 'ATA');
  if (!antarctica?.geometry) throw new Error('Antarctica is missing from the borders.');
  result.features.push({
    type: 'Feature',
    properties: { adm0: 'ATA', outline: true },
    geometry: { type: 'MultiLineString', coordinates: outlineWithoutCuts(antarctica.geometry) },
  });
  return result;
}

const polygonsOf = (geometry) =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

function boundingBox(geometry) {
  const points = polygonsOf(geometry).flat(2);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** A point on the 180° cut: Natural Earth puts cut vertices exactly at ±180. */
const onCut = ([x]) => Math.abs(x) === 180;

/**
 * Joins the pieces of an area that Natural Earth cut at ±180°: pieces west of
 * the cut move east by 360° (Chukotka at -175° becomes 185°) and are unioned
 * with their neighbours, so no edge runs along the cut. Mapbox wraps
 * longitudes past 180° on its own.
 */
export function joinAcrossAntimeridian(geometry, adm0) {
  if (!geometry || adm0 === 'ATA') return geometry;
  const polygons = polygonsOf(geometry);
  if (!polygons.some(([outer]) => outer.some(onCut))) return geometry;
  const moved = polygons.map((polygon) =>
    polygon[0].every(([x]) => x <= 0) && polygon[0].some(([x]) => x === -180)
      ? polygon.map((ring) => ring.map(([x, y]) => [x + 360, y]))
      : polygon,
  );
  const joined = polygonClipping.union(...moved);
  return joined.length === 1
    ? { type: 'Polygon', coordinates: joined[0] }
    : { type: 'MultiPolygon', coordinates: joined };
}

/**
 * Closes a ring that goes around the South Pole. Simplification drops the
 * vertices along the 180° cut and the pole (their triangles have no area), so
 * Antarctica's ring jumps straight from ~180° to ~-180°: Mapbox then fills
 * the wrong side and the tint covers the pole (sprint 1 QA, the disc). This
 * puts the cut and the pole back where the ring crosses 180°.
 */
export function closeAroundSouthPole(ring) {
  // Already closed (the pole survived simplification), or nothing to close.
  if (ring.some(([, y]) => y <= -89.99)) return ring;
  const i = ring.findIndex((point, k) => k > 0 && Math.abs(point[0] - ring[k - 1][0]) > 180);
  if (i === -1) return ring;
  const [a, b] = [ring[i - 1], ring[i]];
  const side = Math.sign(a[0]);
  // Latitude where the coast meets 180°, between a and b (b moved next to a).
  const bx = b[0] + 360 * side;
  const y = a[1] + ((b[1] - a[1]) * (180 * side - a[0])) / (bx - a[0]);
  if (!Number.isFinite(y)) throw new Error(`Cannot close the ring at ${a} → ${b}.`);
  return [
    ...ring.slice(0, i),
    [180 * side, y],
    [180 * side, -90],
    [-180 * side, -90],
    [-180 * side, y],
    ...ring.slice(i),
  ];
}

/**
 * An area's rings as lines, without the segments Natural Earth added to close
 * them: along the 180° cut, and along the pole for Antarctica.
 */
export function outlineWithoutCuts(geometry) {
  const artificial = (a, b) => (onCut(a) && onCut(b)) || (a[1] <= -89.99 && b[1] <= -89.99);
  const lines = [];
  for (const ring of polygonsOf(geometry).flat()) {
    let line = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
      if (artificial(ring[i - 1], ring[i])) {
        if (line.length > 1) lines.push(line);
        line = [ring[i]];
      } else {
        line.push(ring[i]);
      }
    }
    if (line.length > 1) lines.push(line);
  }
  return lines;
}

/**
 * Water bodies inside the land that get the sea tint, by a point inside each.
 * The merged land also has holes that are not water: gaps between countries
 * (Bir Tawil, the Ilemi triangle, Abyei, the Southern Patagonian Ice
 * Field...). Only the ones listed here are tinted.
 */
const INLAND_WATER = [{ name: 'Caspian Sea', point: [51.2, 42.2] }];

/** Shoelace area in square degrees; positive when the ring runs counter-clockwise. */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum / 2;
}

/** GeoJSON (RFC 7946) winding: outer rings counter-clockwise, holes clockwise. */
function wound(ring, counterClockwise) {
  return signedArea(ring) > 0 === counterClockwise ? ring : [...ring].reverse();
}

/** Rounding leaves some tiny rings flat or with fewer than three distinct points. */
function usableRing(ring) {
  const distinct = new Set(ring.map(([x, y]) => `${x},${y}`));
  return distinct.size >= 3 && Math.abs(signedArea(ring)) > 1e-9;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The sea, as one polygon: the whole world with every land ring as a hole,
 * plus the listed inland water as polygons of their own. Built from the same
 * coarse topology as the borders, so the tint's coast matches exactly.
 */
function oceanMask(simplified, iceShelves) {
  const land = merge(simplified, simplified.objects.countries.geometries);
  const world = [
    [-180, -90],
    [180, -90],
    [180, 90],
    [-180, 90],
    [-180, -90],
  ];
  // Antarctica and the islands near it, unioned with the ice shelves: the
  // satellite shows the shelves as white ice, so they are land here.
  const southern = (ring) => ring.every(([, y]) => y < -60);
  const outers = land.coordinates.map(([outer]) =>
    southern(outer) ? closeAroundSouthPole(outer) : outer,
  );
  const antarctic = polygonClipping
    .union(...outers.filter(southern).map((ring) => [ring]), ...iceShelves)
    .map(([outer]) => outer);
  const landRings = roundCoordinates([...outers.filter((ring) => !southern(ring)), ...antarctic])
    .filter(usableRing)
    .map((ring) => wound(ring, false));
  const lakes = roundCoordinates(land.coordinates.flatMap(([, ...holes]) => holes))
    .filter(usableRing)
    .filter((ring) => INLAND_WATER.some(({ point }) => pointInRing(point, ring)))
    .map((ring) => [wound(ring, true)]);
  if (lakes.length !== INLAND_WATER.length) {
    throw new Error(`Expected ${INLAND_WATER.length} inland water bodies, found ${lakes.length}.`);
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[wound(world, true), ...landRings], ...lakes],
        },
      },
    ],
  };
}

/** The Antarctic ice shelves, simplified like the coarse borders. */
function simplifiedIceShelves(source) {
  const topo = presimplify(topology({ shelves: source }, 1e6), sphericalTriangleArea);
  const simplified = simplify(topo, quantile(topo, KEEP_FRACTION));
  const shelves = feature(simplified, simplified.objects.shelves);
  return shelves.features
    .filter((f) => f.geometry)
    .flatMap((f) => polygonsOf(f.geometry))
    .map((polygon) => polygon.filter(usableRing))
    .filter((polygon) => polygon.length > 0);
}

async function main() {
  const source = await loadSource();
  const iceShelves = simplifiedIceShelves(await loadSource(ICE_SHELVES));

  const prepared = applyBorderPolicy(source.features);

  const topo = presimplify(
    topology({ countries: { type: 'FeatureCollection', features: prepared } }, 1e6),
    sphericalTriangleArea,
  );
  // Without this, a single global threshold erases microstates (Vatican,
  // Monaco, ...) entirely: every one of their triangles is "small".
  const protectedCount = protectSmallCountries(topo, prepared);
  const simplified = simplify(topo, quantile(topo, KEEP_FRACTION));
  const result = countriesAt(simplified);

  await mkdir(geoDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(result));

  const detailed = countriesAt(simplify(topo, quantile(topo, DETAIL_KEEP_FRACTION)));
  await writeFile(detailedFile, JSON.stringify(detailed));
  const ocean = oceanMask(simplified, iceShelves);
  await writeFile(oceanFile, JSON.stringify(ocean));

  const { size } = await stat(outFile);
  const { size: detailedSize } = await stat(detailedFile);
  const { size: oceanSize } = await stat(oceanFile);
  console.log(
    `Wrote ${detailedFile}: ${(DETAIL_KEEP_FRACTION * 100).toFixed(1)}% of vertices, ${(detailedSize / 1024).toFixed(0)} KB`,
  );
  console.log(`Wrote ${oceanFile}: ${(oceanSize / 1024).toFixed(0)} KB`);
  console.log(
    `  detailed + ocean mask: ${((detailedSize + oceanSize) / 1024 / 1024).toFixed(2)} MB (budget 5 MB, AC-13a)`,
  );
  // Statistics are about areas; Antarctica's outline line feature is not one.
  const areas = result.features.filter((f) => !f.properties.outline);
  const missingCode = areas.filter((f) => !f.properties.code);
  const missingHebrew = areas.filter((f) => !f.properties.nameHe);
  const missingGeometry = areas.filter((f) => !f.geometry);

  console.log(`Wrote ${outFile}`);
  console.log(`  areas: ${areas.length}, size: ${(size / 1024).toFixed(0)} KB`);
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
  const drift = areas
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

// Imported by the tests for the geometry helpers; only builds when run directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
