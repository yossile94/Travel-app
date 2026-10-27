import fs from 'node:fs';
import path from 'node:path';

import { connections, layover, routes, sameBooking, type Leg } from './connections';
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

const NOW = new Date('2026-12-01T00:00:00Z');

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
    arrMct: 60,
    ...over,
  }) as Flight;

const watched = (status: string, departure = {}, arrival = {}, iata = 'IST') =>
  ({
    state: 'active',
    checkedAt: '2026-11-30T23:00:00Z',
    landedAt: null,
    events: [],
    snapshot: {
      number: 'TK1',
      airlineIata: 'TK',
      status,
      departure: { iata, ...departure },
      arrival,
    },
  }) as Flight['watch'];

const pair = (landed: string, leaves: string, status = 'Expected', mct: number | null = 60) => [
  flight({ id: 'a', arrSched: landed, arrMct: mct }),
  flight({ id: 'b', depIata: 'IST', depSched: leaves, watch: watched(status) }),
];

describe('layover (sprint 7 AC-2, design 3.2)', () => {
  it.each([
    ['risky under the minimum', '2026-12-01T08:59:00Z', 'risky', 59],
    ['short at the minimum', '2026-12-01T09:00:00Z', 'short', 60],
    ['short below the minimum and 30', '2026-12-01T09:29:00Z', 'short', 89],
    ['ok at the minimum and 30', '2026-12-01T09:30:00Z', 'ok', 90],
    ['missed at 0', '2026-12-01T08:00:00Z', 'missed', 0],
    ['missed below 0', '2026-12-01T07:50:00Z', 'missed', -10],
  ])('%s', (_, leaves, status, minutes) => {
    const [a, b] = pair('2026-12-01T08:00:00Z', leaves);
    expect(layover(a!, b!, NOW)).toEqual({ status, minutes, mct: 60 });
  });

  it('whole minutes, floored as the server does: 59.6 is risky (Raz design 4)', () => {
    const [a, b] = pair('2026-12-01T08:00:00Z', '2026-12-01T08:59:36Z');
    expect(layover(a!, b!, NOW).status).toBe('risky');
  });

  it('no minimum from the server: no status, the client sets no default', () => {
    const [a, b] = pair('2026-12-01T08:00:00Z', '2026-12-01T10:00:00Z', 'Expected', null);
    expect(layover(a!, b!, NOW)).toEqual({ status: 'no_mct', minutes: 120, mct: null });
  });

  it('a cancelled leg: the connection no longer holds', () => {
    const [a, b] = pair('2026-12-01T08:00:00Z', '2026-12-01T12:00:00Z', 'Canceled');
    expect(layover(a!, b!, NOW).status).toBe('invalid');
  });

  it('a live landing time counts over the schedule', () => {
    const [a, b] = pair('2026-12-01T08:00:00Z', '2026-12-01T10:00:00Z');
    a!.watch = watched('Expected', {}, { revisedUtc: '2026-12-01T09:20:00Z' }, 'TLV');
    expect(layover(a!, b!, NOW)).toEqual({ status: 'risky', minutes: 40, mct: 60 });
  });

  it("another leg's data under the same number is not this leg's time (Raz design 2)", () => {
    const [a, b] = pair('2026-12-01T08:00:00Z', '2026-12-01T10:00:00Z');
    a!.watch = watched('Expected', {}, { revisedUtc: '2026-12-01T09:50:00Z' }, 'ATH');
    expect(layover(a!, b!, NOW).minutes).toBe(120);
  });
});

describe('routes and the booking answer (design 2.1, 3.6)', () => {
  it('a route takes the place of its first leg; a lone flight stays itself', () => {
    const legs = [
      flight({ id: 'a', depSched: '2026-12-01T06:00:00Z', arrSched: '2026-12-01T08:00:00Z' }),
      flight({
        id: 'b',
        depIata: 'IST',
        arrIata: 'BKK',
        depSched: '2026-12-01T10:00:00Z',
        arrSched: '2026-12-01T20:00:00Z',
      }),
      flight({
        id: 'c',
        direction: 'return',
        depIata: 'BKK',
        arrIata: 'TLV',
        depSched: '2026-12-10T06:00:00Z',
        arrSched: '2026-12-10T16:00:00Z',
      }),
    ];
    const items = routes(legs);
    expect(
      items.map((i) => (i.kind === 'route' ? i.legs.map((l) => l.id).join('>') : i.flight.id)),
    ).toEqual(['a>b', 'c']);
  });

  it('the answer holds only for the leg now before', () => {
    const next = flight({ id: 'b', sameBooking: false, sameBookingPrev: 'a' });
    expect(sameBooking(next, 'a')).toBe(false);
    expect(sameBooking(next, 'x')).toBeNull();
  });
});
