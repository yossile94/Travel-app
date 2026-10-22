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

  it('uses the Israeli point of view', () => {
    assert.equal(byCode.get('IL')?.properties.nameHe, 'ישראל');
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
