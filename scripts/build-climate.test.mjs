/**
 * The bundled climate normals (sprint 3 F-011, AC-10 to AC-12): the grid
 * maths, reference cities against published 1991-2020 normals, the areas
 * without a value, and the size budget shared with the city list.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { anomalousCells, CAPITALS, CITY_NORMALS, cellOf, valueCell } from './build-climate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'apps', 'mobile', 'assets', 'data');
const text = readFileSync(join(dataDir, 'climate.dat'), 'utf8');
const data = JSON.parse(text);
const cells = Buffer.from(data.cells, 'base64');
const slotOf = new Map();
let id = 0;
for (let i = 0; i < data.cities.length; i += 2) {
  id += data.cities[i];
  slotOf.set(id, data.cities[i + 1]);
}
const month = (slot, m) => cells.readInt16LE((slot * 12 + m) * 2) / data.scale;

describe('climate build (sprint 3 AC-10 to AC-12)', () => {
  it('maps a point to its 0.5 degree cell, rows from the south', () => {
    assert.equal(cellOf([-179.9, -89.9]), 0);
    assert.equal(cellOf([179.9, 89.9]), 360 * 720 - 1);
    // Tel Aviv: row 244, column 429.
    assert.equal(cellOf([34.78, 32.08]), 244 * 720 + 429);
  });

  it('falls back to the nearest cell with a value, one ring then two, else none', () => {
    const normals = new Map([[2 * 720 + 2, []]]);
    assert.equal(valueCell(2 * 720 + 2, normals), 2 * 720 + 2);
    assert.equal(valueCell(1 * 720 + 1, normals), 2 * 720 + 2);
    assert.equal(valueCell(0, normals), 2 * 720 + 2);
    assert.equal(valueCell(10 * 720 + 10, normals), null);
  });

  // Published 1991-2020 daily means (January, July), within 2 degrees (AC-12).
  // Mountain cities get a wider band (AC-12's known limit). Eilat, at sea
  // level in a mountain cell, comes from CITY_NORMALS (Raz, T1).
  const reference = [
    [293397, 'Tel Aviv', 13.6, 26.8, 2],
    [1609350, 'Bangkok', 27.0, 29.3, 2],
    [2643743, 'London', 5.5, 18.6, 2],
    [3413829, 'Reykjavik', -0.1, 11.4, 2],
    [1880252, 'Singapore', 26.7, 28.1, 2],
    [2562305, 'Valletta', 12.6, 26.6, 2],
    [1282027, 'Male', 28.0, 28.3, 2],
    // A coastal capital outside the simplified polygon (Dudi, T1).
    [3421319, 'Nuuk', -7.0, 7.0, 2],
    // Eilat's values are CITY_NORMALS, typed in from its source: this checks
    // the entry and the wiring, not CRU (Dudi).
    [295277, 'Eilat', 16.0, 33.0, 2],
    // Mountain cities: the Andes.
    [3652462, 'Quito', 14.0, 14.0, 4],
    [3911925, 'La Paz', 8.0, 6.0, 4],
  ];
  for (const [cityId, name, jan, jul, band] of reference) {
    it(`${name} is within ${band} degrees of its published normals`, () => {
      const slot = slotOf.get(cityId);
      assert.notEqual(slot, undefined);
      assert.ok(Math.abs(month(slot, 0) - jan) <= band, `${name} Jan ${month(slot, 0)}`);
      assert.ok(Math.abs(month(slot, 6) - jul) <= band, `${name} Jul ${month(slot, 6)}`);
    });
  }

  it('drops a cell whose year does not follow its neighbours (the Dead Sea, QA)', () => {
    const season = [10, 12, 15, 19, 23, 26, 28, 28, 25, 21, 16, 12].map((v) => v * 100);
    const flat = [20, 17, 18, 16, 15, 16, 17, 17, 16, 17, 17, 16].map((v) => v * 100);
    const normals = new Map();
    for (const cell of [0, 1, 2, 720, 722, 1440, 1441, 1442]) normals.set(cell + 1000, season);
    normals.set(721 + 1000, flat);
    assert.deepEqual([...anomalousCells(normals)], [1721]);
    // Only two cells in the world, both in the Dead Sea basin.
    assert.equal(data.source.anomalousCells.length, 2);
  });

  it('every Israeli city is warmer in July than in January', () => {
    const cities = JSON.parse(readFileSync(join(dataDir, 'cities.dat'), 'utf8'));
    for (const [cityId, , nameEn] of cities.areas.ISR) {
      const slot = slotOf.get(cityId);
      if (slot === undefined) continue;
      assert.ok(
        month(slot, 6) > month(slot, 0) + 5,
        `${nameEn} ${month(slot, 0)} / ${month(slot, 6)}`,
      );
    }
  });

  it('city overrides keep their source', () => {
    for (const [cityId, c] of Object.entries(CITY_NORMALS)) {
      assert.equal(c.months.length, 12);
      assert.match(data.source.cityNormals[cityId], /1991-2020/);
    }
  });

  it('locks the areas shown at their label point, with no city (Dudi, T1)', () => {
    const labelOnly = Object.entries(data.areas)
      .filter(([, v]) => !v[1])
      .map(([adm0]) => adm0)
      .sort();
    assert.deepEqual(labelOnly, ['BRI', 'GIB', 'HMD', 'IOT', 'SAH', 'UMI', 'VAT']);
    assert.equal(data.areas.GRL[3], 'Nuuk');
  });

  it('locks the areas with no value (the field is hidden there)', () => {
    assert.deepEqual(data.noValue, ['ATA', 'ATC', 'CLP', 'CSI']);
  });

  it("an area's climate point: the capital from the exceptions table", () => {
    assert.equal(data.areas.ISR[1], CAPITALS.ISR);
    assert.equal(data.areas.ISR[2], 'ירושלים');
    assert.equal(data.areas.THA[3], 'Bangkok');
  });

  it('every value is a plausible monthly mean', () => {
    for (let i = 0; i < cells.length; i += 2) {
      const v = cells.readInt16LE(i) / data.scale;
      assert.ok(v > -60 && v < 45, `${v}`);
    }
  });

  // Sprint 9 (Raz, D1-D2): wet days and city coordinates raise the budget to
  // 1.3 MB, within the +300 KB Yossi approved for discovery.
  it('cities and climate together stay within the 1.3 MB budget (AC-12, sprint 9)', () => {
    const cities = readFileSync(join(dataDir, 'cities.dat'), 'utf8');
    const total = gzipSync(text).length + gzipSync(cities).length;
    assert.ok(total < 1.3 * 1024 * 1024, `${(total / 1024).toFixed(0)} KB`);
  });
});

describe('wet days (sprint 9, discovery 5.12)', () => {
  const wet = Buffer.from(data.wet, 'base64');
  const slotOf = (adm0) => data.areas[adm0][0];
  const days = (adm0, month) => wet[slotOf(adm0) * 12 + month];

  it('version 2 carries one byte per slot and month, in whole days', () => {
    assert.equal(data.version, 2);
    assert.equal(wet.length, cells.length / 2);
    for (const v of wet) assert.ok(v <= 31 || v === 255, `${v}`);
  });

  it('Bangkok is dry in December, wet in September', () => {
    assert.ok(days('THA', 11) < 4, `${days('THA', 11)}`);
    assert.ok(days('THA', 8) > 15, `${days('THA', 8)}`);
  });
});
