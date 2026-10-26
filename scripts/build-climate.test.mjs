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

import { CAPITALS, cellOf, valueCell } from './build-climate.mjs';

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
  // A 0.5 degree cell averages its land: where it also holds mountains, the
  // value is lower (a known limit, ADR-007), so those get a wider band.
  const reference = [
    [293397, 'Tel Aviv', 13.6, 26.8, 2],
    [1609350, 'Bangkok', 27.0, 29.3, 2],
    [2643743, 'London', 5.5, 18.6, 2],
    [3413829, 'Reykjavik', -0.1, 11.4, 2],
    [1880252, 'Singapore', 26.7, 28.1, 2],
    [2562305, 'Valletta', 12.6, 26.6, 2],
    [1282027, 'Male', 28.0, 28.3, 2],
    // Mountains in the cell: Edom and Sinai (Eilat), the Andes (Quito, La Paz).
    [295277, 'Eilat', 16.0, 32.5, 6],
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

  it('cities and climate together stay within the 1 MB budget (AC-12)', () => {
    const cities = readFileSync(join(dataDir, 'cities.dat'), 'utf8');
    const total = gzipSync(text).length + gzipSync(cities).length;
    assert.ok(total < 1024 * 1024, `${(total / 1024).toFixed(0)} KB`);
  });
});
