/**
 * The bundled city list (sprint 3 F-008, AC-4): cities are in the right
 * area, Hebrew names are clean, the limits hold, and the file stays small.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  NAME_MAX,
  areaOf,
  cleanName,
  hebrewNames,
  inGeometry,
  isForbidden,
} from './build-cities.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(
  readFileSync(join(root, 'apps', 'mobile', 'assets', 'data', 'cities.dat'), 'utf8'),
);
const areaOfCity = (nameEn) =>
  Object.entries(data.areas).find(([, list]) => list.some((c) => c[2] === nameEn))?.[0] ?? null;

describe('city list build (sprint 3 AC-4)', () => {
  const square = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
  };

  it('point in polygon respects holes', () => {
    assert.equal(inGeometry([1, 1], square), true);
    assert.equal(inGeometry([5, 5], square), false);
    assert.equal(inGeometry([11, 5], square), false);
  });

  it('a coastal point within 10 km joins the nearest area; farther out is sea', () => {
    const areas = [{ adm0: 'AAA', geometry: square, box: [0, 0, 10, 10] }];
    assert.equal(areaOf([10.05, 5], areas)?.adm0, 'AAA');
    assert.equal(areaOf([12, 5], areas), null);
  });

  it('picks a preferred Hebrew name, never historic or with niqqud', () => {
    const rows = [
      ['1', '7', 'he', 'יְרוּשָׁלַיִם', '', '', '', ''],
      ['2', '7', 'he', 'שלם', '', '', '', '1'],
      ['3', '7', 'he', 'ירושלם', '', '', '', ''],
      ['4', '7', 'he', 'ירושלים', '1', '', '', ''],
      ['5', '8', 'he', 'Tel Aviv', '', '', '', ''],
    ].map((r) => r.join('\t'));
    const names = hebrewNames(rows);
    assert.equal(names.get('7'), 'ירושלים');
    assert.equal(names.has('8'), false);
  });

  it('assigns cities to the globe areas (Raz, finding 9)', () => {
    assert.equal(areaOfCity('Ramallah'), 'ISR');
    assert.equal(areaOfCity('Ariel'), 'ISR');
    assert.equal(areaOfCity('Gaza'), null, 'Gaza is not a selectable area');
    assert.equal(areaOfCity('Valletta'), 'MLT');
    assert.equal(areaOfCity('Bangkok'), 'THA');
  });

  it('orders each area by population and keeps names within the database limit', () => {
    for (const list of Object.values(data.areas)) {
      for (let i = 1; i < list.length; i++) assert.ok(list[i - 1][4] >= list[i][4]);
      for (const [, he, en] of list) {
        assert.ok([...he].length <= NAME_MAX && [...en].length <= NAME_MAX);
      }
    }
    assert.equal(data.areas.ISR[0][1], 'ירושלים');
  });

  it('no name has a character the database refuses, or space at an end (Raz, M1)', () => {
    const bad = Object.values(data.areas)
      .flat()
      .flatMap((c) => [c[1], c[2], c[3]])
      .filter((n) => n && ([...n].some((ch) => isForbidden(ch.codePointAt(0))) || n !== n.trim()));
    assert.deepEqual(bad, []);
  });

  it('cleans hidden marks out of a name', () => {
    const rlm = String.fromCodePoint(0x200f);
    assert.equal(cleanName(rlm + 'נהריה '), 'נהריה');
  });

  it('a city 8 km off a coast far north still joins its country (Raz, m10)', () => {
    const iceland = {
      adm0: 'ISL',
      box: [-24, 63.3, -13.5, 66.6],
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-24, 63.3],
            [-13.5, 63.3],
            [-13.5, 66.6],
            [-24, 66.6],
            [-24, 63.3],
          ],
        ],
      },
    };
    // 0.17 degrees of longitude west of the box at 64 degrees north is about 8.3 km.
    assert.equal(areaOf([-24.17, 64], [iceland])?.adm0, 'ISL');
  });

  it('stays small: under 600 KB compressed (the 1 MB budget includes climate)', () => {
    const raw = readFileSync(join(root, 'apps', 'mobile', 'assets', 'data', 'cities.dat'));
    assert.ok(gzipSync(raw).length < 600 * 1024, `${gzipSync(raw).length} bytes`);
  });
});
