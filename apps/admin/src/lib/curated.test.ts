// Sprint 11 F-032 (D15): the curated place's rules against the shared table
// of cases; the database runs the same table (admin_cases.test.sql).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  cityFor,
  curatedErrors,
  curatedPayload,
  parseCoords,
  type CuratedForm,
} from './curated.ts';

const root = path.join(import.meta.dirname, '../../../..');
const cases = JSON.parse(
  fs.readFileSync(path.join(root, 'supabase/tests/fixtures/admin_cases.json'), 'utf8'),
) as {
  today: string;
  curated: { name: string; input: CuratedForm; ok: boolean; field?: string }[];
};
/** "x281" in the table stands for 281 characters. */
const expand = (v: string) => (/^x\d+$/.test(v) ? 'x'.repeat(Number(v.slice(1))) : v);

describe('curated places (AC-19, D15)', () => {
  for (const c of cases.curated) {
    it(c.name, () => {
      const input = { ...c.input, nameHe: expand(c.input.nameHe), body: expand(c.input.body) };
      const errors = curatedErrors(input, cases.today);
      if (c.ok) assert.deepEqual(errors, {});
      else assert.ok(errors[c.field as keyof typeof errors], `expected an error on ${c.field}`);
    });
  }

  it('a verification date after today is refused in the panel', () => {
    const f = { ...cases.curated[0]!.input, verified: '2026-10-29' };
    assert.equal(curatedErrors(f, cases.today).verified, 'verifiedFuture');
  });

  it('the row: trimmed, an empty description is null, the point as numbers', () => {
    const row = curatedPayload({ ...cases.curated[0]!.input, nameEn: ' Chabad ', body: '  ' });
    assert.equal(row.name_en, 'Chabad');
    assert.equal(row.body, null);
    assert.deepEqual([row.lat, row.lng], [13.759, 100.497]);
  });
});

describe('coordinates and the city (design 23.3, D18)', () => {
  it('reads what is copied from a maps app, and says which part is wrong', () => {
    assert.deepEqual(parseCoords('13.7590, 100.4970'), { lat: 13.759, lng: 100.497 });
    assert.deepEqual(parseCoords('-33.8688 151.2093'), { lat: -33.8688, lng: 151.2093 });
    assert.equal(parseCoords('Bangkok'), 'coords');
    assert.equal(parseCoords('91, 0'), 'lat');
    assert.equal(parseCoords('0, 181'), 'lng');
  });

  it('the nearest listed city within 15 km, or none', () => {
    const cities = [
      { name: 'בנגקוק', point: [100.5018, 13.7563] as [number, number] },
      { name: 'נונתבורי', point: [100.5144, 13.8621] as [number, number] },
    ];
    assert.equal(cityFor([100.497, 13.759], cities)?.name, 'בנגקוק');
    assert.equal(cityFor([98.98, 18.79], cities), null);
  });
});
