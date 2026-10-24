/**
 * Guards the bundled borders file built by scripts/build-countries.mjs. If the
 * source or the simplification changes, these catch countries that vanish,
 * lose their Hebrew name, or break. Runs with Node's built-in test runner.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const file = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'mobile',
  'assets',
  'geo',
  'countries.geojson',
);
const bytes = readFileSync(file);
const { features } = JSON.parse(bytes.toString('utf8'));

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function contains(geometry, point) {
  if (!geometry) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(
    ([outer, ...holes]) => inRing(point, outer) && !holes.some((hole) => inRing(point, hole)),
  );
}

// The main shape for each code (overseas territories come after their parent).
const byCode = new Map();
for (const f of features) {
  if (f.properties.code && !byCode.has(f.properties.code)) byCode.set(f.properties.code, f);
}

describe('bundled country borders', () => {
  it('stays small enough to ship in the app', () => {
    assert.ok(bytes.byteLength < 1.6 * 1024 * 1024, `${bytes.byteLength} bytes`);
  });

  it('contains every Natural Earth admin-0 area', () => {
    assert.equal(features.length, 250);
  });

  it('gives every area a polygon shape', () => {
    for (const f of features) {
      assert.match(f.geometry?.type ?? 'none', /^(Multi)?Polygon$/, f.properties.nameEn);
    }
  });

  it('names every area in Hebrew and English', () => {
    for (const { properties } of features) {
      assert.ok(properties.nameEn?.trim(), `English name for ${properties.adm0}`);
      assert.ok(properties.nameHe?.trim(), `Hebrew name for ${properties.nameEn}`);
    }
  });

  it('has a label point on the globe for every area', () => {
    for (const { properties } of features) {
      const [lng, lat] = properties.label;
      assert.ok(lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90, properties.nameEn);
    }
  });

  it('shares an ISO code only for known overseas territories of the same country', () => {
    // Clipperton (FR), Brazilian Island (BR) and three Australian territories
    // carry their parent's code: tapping them opens the parent country.
    const counts = new Map();
    for (const { properties } of features) {
      if (properties.code) counts.set(properties.code, (counts.get(properties.code) ?? 0) + 1);
    }
    const shared = [...counts].filter(([, n]) => n > 1).map(([code]) => code);
    assert.deepEqual(shared.sort(), ['AU', 'BR', 'FR']);
  });

  it('keeps microstates after simplification (sprint 0 AC-5)', () => {
    for (const code of ['VA', 'MC', 'SM', 'LI', 'AD', 'MT', 'SG', 'BH', 'MV', 'LU']) {
      assert.ok(byCode.get(code)?.geometry, `${code} has a shape`);
    }
  });

  it('names the Spratly Islands correctly (Natural Earth labels them "Wake Island")', () => {
    const spratly = features.find((f) => f.properties.adm0 === 'PGA');
    assert.equal(spratly.properties.nameEn, 'Spratly Islands');
    assert.equal(spratly.properties.nameHe, 'איי ספרטלי');
  });

  it('uses the Israeli point of view', () => {
    assert.equal(byCode.get('IL')?.properties.nameHe, 'ישראל');
  });

  describe('border policy (Yossi, 2026-10-22)', () => {
    const israel = byCode.get('IL');
    const gaza = features.find((f) => f.properties.adm0 === 'GAZ');
    const areaAt = (point) => features.find((f) => contains(f.geometry, point))?.properties.adm0;

    it('shows Judea and Samaria, all of Jerusalem and the Golan as Israel', () => {
      for (const [place, point] of Object.entries({
        'Tel Aviv': [34.78, 32.08],
        'Jerusalem, Old City': [35.234, 31.777],
        Ramallah: [35.2, 31.9],
        Hebron: [35.1, 31.53],
        Ariel: [35.17, 32.1],
        Katzrin: [35.69, 32.99],
        Eilat: [34.95, 29.56],
      })) {
        assert.equal(areaAt(point), 'ISR', place);
      }
    });

    it('draws Israel as one shape, with no seam where Judea and Samaria were joined', () => {
      const polygons =
        israel.geometry.type === 'Polygon'
          ? [israel.geometry.coordinates]
          : israel.geometry.coordinates;
      assert.equal(polygons.length, 1);
      assert.equal(polygons[0].length, 1, 'no holes');
    });

    it('shows the Gaza Strip as its own area, named in Hebrew and English', () => {
      assert.equal(areaAt([34.46, 31.5]), 'GAZ');
      assert.equal(gaza?.properties.nameHe, 'רצועת עזה');
      assert.equal(gaza?.properties.nameEn, 'Gaza Strip');
    });

    it('does not offer the Gaza Strip as a destination', () => {
      assert.equal(gaza?.properties.code, null);
    });

    it('no longer contains the source "Palestine" feature', () => {
      assert.equal(
        features.some((f) => f.properties.adm0 === 'PSX'),
        false,
      );
    });
  });

  for (const [code, nameHe] of [
    ['TH', 'תאילנד'],
    ['GR', 'יוון'],
    ['CY', 'קפריסין'],
    ['IT', 'איטליה'],
    ['JP', 'יפן'],
  ]) {
    it(`has popular destination ${code} with its Hebrew name`, () => {
      assert.equal(byCode.get(code)?.properties.nameHe, nameHe);
    });
  }
});

describe('detailed borders and ocean mask (sprint 1 F-001.1)', () => {
  const geoDir = dirname(file);
  const detailedBytes = readFileSync(join(geoDir, 'countries-detailed.geojson'));
  const oceanBytes = readFileSync(join(geoDir, 'ocean-mask.geojson'));
  const detailed = JSON.parse(detailedBytes.toString('utf8')).features;
  const ocean = JSON.parse(oceanBytes.toString('utf8')).features;

  it('has the same areas, with the same properties, at both levels', () => {
    assert.deepEqual(
      detailed.map((f) => f.properties),
      features.map((f) => f.properties),
    );
  });

  it('keeps more of each coastline in the detailed level', () => {
    const vertices = (f) => JSON.stringify(f.geometry.coordinates).split('],[').length;
    // Greece: a long, broken coastline (small countries such as Israel keep every vertex at both levels).
    const greece = (list) => list.find((f) => f.properties.adm0 === 'GRC');
    assert.ok(vertices(greece(detailed)) > vertices(greece(features)) * 2);
  });

  it('fits the 5 MB budget for the detailed borders plus the ocean mask (AC-13a)', () => {
    assert.ok(detailedBytes.length + oceanBytes.length <= 5 * 1024 * 1024);
  });

  it('is one sea polygon with the land as holes, and only real water tinted inland (AC-8)', () => {
    assert.equal(ocean.length, 1);
    const { type, coordinates } = ocean[0].geometry;
    assert.equal(type, 'MultiPolygon');
    const [[world, ...landHoles], ...lakes] = coordinates;
    assert.deepEqual(world[0], [-180, -90]);
    assert.ok(landHoles.length > 100, `land rings: ${landHoles.length}`);
    // Mid-Atlantic is sea: inside the world ring and in no land ring.
    const atlantic = [-30, 20];
    assert.ok(inRing(atlantic, world));
    assert.ok(!landHoles.some((ring) => inRing(atlantic, ring)));
    // Central Africa is land.
    assert.ok(landHoles.some((ring) => inRing([20, 5], ring)));
    // Inland: the Caspian is tinted; gaps between countries are not water.
    assert.equal(lakes.length, 1);
    assert.ok(inRing([51.2, 42.2], lakes[0][0]), 'Caspian Sea');
    for (const [name, point] of [
      ['Ilemi triangle', [35.3, 4.7]],
      ['Southern Patagonian Ice Field', [-73.3, -49.4]],
      ['Abyei', [28.4, 9.7]],
    ]) {
      assert.ok(!lakes.some(([ring]) => inRing(point, ring)), `${name} is not water`);
    }
  });

  it('winds rings as GeoJSON expects and drops flat ones (Mapbox classifies by winding)', () => {
    const area = (ring) => {
      let sum = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      }
      return sum / 2;
    };
    const [[world, ...holes], ...lakes] = ocean[0].geometry.coordinates;
    assert.ok(area(world) > 0, 'world ring counter-clockwise');
    for (const hole of holes) assert.ok(area(hole) < 0, 'land holes clockwise');
    for (const [lake] of lakes) assert.ok(area(lake) > 0, 'lake polygons counter-clockwise');
    for (const ring of [...holes, ...lakes.map(([lake]) => lake)]) {
      assert.ok(new Set(ring.map(String)).size >= 3, 'no ring with fewer than three points');
    }
  });
});
