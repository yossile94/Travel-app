import fs from 'node:fs';
import path from 'node:path';

import { connections, layoverStatus, type Leg } from './connections';
import type { Flight } from './flightModel';

interface Case {
  name: string;
  flights: {
    id: string;
    direction: Leg['direction'];
    dep: string;
    arr: string | null;
    depSched: string | null;
    arrSched: string | null;
  }[];
  expected: [string, string][];
}

// The one table the database's rule is tested against too (Raz, sprint 7 check 2).
const { cases } = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../../../../../supabase/tests/fixtures/connection_cases.json'),
    'utf8',
  ),
) as { cases: Case[] };

describe('connections (sprint 7 AC-1)', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const legs: Leg[] = c.flights.map((f) => ({
      id: f.id,
      tripId: 't',
      direction: f.direction,
      depIata: f.dep,
      arrIata: f.arr,
      depSched: f.depSched,
      arrSched: f.arrSched,
    }));
    expect(connections(legs).map((x) => [x.prevId, x.nextId])).toEqual(c.expected);
  });

  it('flights of two trips never connect', () => {
    const [a, b] = cases[0]!.flights;
    const legs: Leg[] = [a!, b!].map((f, i) => ({
      id: f.id,
      tripId: `t${i}`,
      direction: f.direction,
      depIata: f.dep,
      arrIata: f.arr,
      depSched: f.depSched,
      arrSched: f.arrSched,
    }));
    expect(connections(legs)).toEqual([]);
  });
});

const flight = (over: Partial<Flight>): Flight =>
  ({
    id: 'f',
    tripId: 't',
    direction: 'out',
    depIata: 'TLV',
    arrIata: 'IST',
    depSched: null,
    arrSched: null,
    watch: null,
    ...over,
  }) as Flight;

const pair = (landed: string, leaves: string, status = 'Expected') => [
  flight({ id: 'a', arrSched: landed }),
  flight({
    id: 'b',
    depIata: 'IST',
    depSched: leaves,
    watch: {
      state: 'active',
      checkedAt: null,
      landedAt: null,
      events: [],
      snapshot: {
        number: 'TK1',
        airlineIata: 'TK',
        status,
        departure: {} as never,
        arrival: {} as never,
      },
    },
  }),
];

describe('layoverStatus (sprint 7 AC-2)', () => {
  it.each([
    ['risky under the minimum', '2026-12-01T08:59:00Z', 'risky', 59],
    ['short at the minimum', '2026-12-01T09:00:00Z', 'short', 60],
    ['short below the minimum and 30', '2026-12-01T09:29:00Z', 'short', 89],
    ['enough at the minimum and 30', '2026-12-01T09:30:00Z', 'enough', 90],
    ['missed at 0', '2026-12-01T08:00:00Z', 'missed', 0],
  ])('%s', (_, leaves, status, minutes) => {
    const [a, b] = pair('2026-12-01T08:00:00Z', leaves);
    expect(layoverStatus(a!, b!, 60)).toEqual({ status, minutes });
  });

  it('a cancelled leg: the connection no longer holds', () => {
    const [a, b] = pair('2026-12-01T08:00:00Z', '2026-12-01T12:00:00Z', 'Canceled');
    expect(layoverStatus(a!, b!).status).toBe('void');
  });

  it('a live landing time counts over the schedule', () => {
    const [a, b] = pair('2026-12-01T08:00:00Z', '2026-12-01T10:00:00Z');
    a!.watch = {
      state: 'active',
      checkedAt: null,
      landedAt: null,
      events: [],
      snapshot: {
        number: 'LY1',
        airlineIata: 'LY',
        status: 'Expected',
        departure: {} as never,
        arrival: { revisedUtc: '2026-12-01T09:20:00Z' } as never,
      },
    };
    expect(layoverStatus(a!, b!, 60)).toEqual({ status: 'risky', minutes: 40 });
  });
});
