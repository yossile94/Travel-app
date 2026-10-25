/**
 * Unit tests for the geometry helpers in build-countries.mjs (sprint 1 QA:
 * the South Pole disc and the 180° cut). countries.test.mjs checks the files
 * they produce; these check the edge cases directly.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  closeAroundSouthPole,
  joinAcrossAntimeridian,
  outlineWithoutCuts,
} from './build-countries.mjs';

describe('closeAroundSouthPole', () => {
  // A coast around the pole that jumps from 170° to -170° (the cut was simplified away).
  const coast = [
    [-170, -70],
    [0, -65],
    [170, -70],
    [-170, -70],
  ];

  it('puts the cut and the pole back where the ring jumps across 180°', () => {
    const closed = closeAroundSouthPole(coast);
    assert.deepEqual(closed.slice(3, 7), [
      [180, -70],
      [180, -90],
      [-180, -90],
      [-180, -70],
    ]);
    assert.ok(closed.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  });

  it('interpolates the latitude where the coast meets 180°', () => {
    const [, , , [x, y]] = closeAroundSouthPole([
      [-170, -70],
      [0, -65],
      [170, -60],
      [-170, -80],
    ]);
    assert.equal(x, 180);
    assert.equal(y, -70);
  });

  it('leaves a ring that already reaches the pole alone (no division by zero)', () => {
    const withPole = [
      [-180, -70],
      [0, -65],
      [180, -70],
      [180, -90],
      [-180, -90],
      [-180, -70],
    ];
    assert.deepEqual(closeAroundSouthPole(withPole), withPole);
  });

  it('leaves a ring without a jump alone', () => {
    const island = [
      [10, -70],
      [12, -70],
      [11, -69],
      [10, -70],
    ];
    assert.deepEqual(closeAroundSouthPole(island), island);
  });
});

describe('joinAcrossAntimeridian', () => {
  const east = [
    [
      [170, 60],
      [180, 60],
      [180, 70],
      [170, 70],
      [170, 60],
    ],
  ];
  const west = [
    [
      [-180, 60],
      [-170, 60],
      [-170, 70],
      [-180, 70],
      [-180, 60],
    ],
  ];

  it('joins the pieces cut at ±180° into one shape past 180°', () => {
    const joined = joinAcrossAntimeridian(
      { type: 'MultiPolygon', coordinates: [east, west] },
      'RUS',
    );
    assert.equal(joined.type, 'Polygon');
    const xs = joined.coordinates[0].map(([x]) => x);
    assert.equal(Math.min(...xs), 170);
    assert.equal(Math.max(...xs), 190);
    assert.ok(!joined.coordinates[0].some(([x]) => x === 180), 'no vertex left on the cut');
  });

  it('leaves areas that do not touch the cut, and Antarctica, alone', () => {
    const france = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 45],
          [5, 45],
          [5, 50],
          [0, 45],
        ],
      ],
    };
    assert.equal(joinAcrossAntimeridian(france, 'FRA'), france);
    const cut = { type: 'MultiPolygon', coordinates: [east, west] };
    assert.equal(joinAcrossAntimeridian(cut, 'ATA'), cut);
  });
});

describe('outlineWithoutCuts', () => {
  it('drops the segments along 180° and along the pole', () => {
    const ring = [
      [-180, -70],
      [0, -65],
      [180, -70],
      [180, -90],
      [-180, -90],
      [-180, -70],
    ];
    const lines = outlineWithoutCuts({ type: 'Polygon', coordinates: [ring] });
    assert.deepEqual(lines, [
      [
        [-180, -70],
        [0, -65],
        [180, -70],
      ],
    ]);
  });
});
