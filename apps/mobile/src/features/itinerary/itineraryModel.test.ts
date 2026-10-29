// Sprint 11 F-030 (design 9, AC-8, AC-12, D16): the board's days, labels and
// the items outside the dates.
import type { Flight } from '@/features/flights/flightModel';

import {
  boardCounts,
  busyDays,
  flightAnchors,
  itineraryDays,
  moveWithinDay,
  plannerEnd,
  type Item,
} from './itineraryModel';

const flight = (over: Partial<Flight>): Flight =>
  ({
    id: 'f',
    tripId: 't',
    direction: 'out',
    numberInput: 'LY81',
    number: 'LY81',
    depDateLocal: '2027-01-04',
    airline: null,
    depIata: 'TLV',
    depTz: 'Asia/Jerusalem',
    depCountry: 'ISR',
    arrIata: 'BKK',
    arrTz: 'Asia/Bangkok',
    arrCountry: 'THA',
    depSched: null,
    arrSched: null,
    depTerminal: null,
    depGate: null,
    arrTerminal: null,
    arrGate: null,
    pnr: null,
    seat: null,
    cabin: null,
    ...over,
  }) as Flight;
const item = (id: string, day: string, sortOrder: number, over: Partial<Item> = {}): Item => ({
  id,
  tripId: 't',
  day,
  time: null,
  title: id,
  note: null,
  placeRef: null,
  placeName: null,
  lat: null,
  lng: null,
  source: 'manual',
  sortOrder,
  ...over,
});

describe('the flights give the first and last day (D16)', () => {
  it('the outbound arrival local to Bangkok, with the hours since take-off; the return take-off', () => {
    const anchors = flightAnchors([
      // TLV 22:00 (UTC 20:00) → BKK 11:30 next day local (UTC 04:30): 8.5 h.
      flight({ id: 'a', depSched: '2027-01-04T20:00:00Z', arrSched: '2027-01-05T04:30:00Z' }),
      flight({
        id: 'b',
        direction: 'return',
        depIata: 'BKK',
        depTz: 'Asia/Bangkok',
        arrTz: 'Asia/Jerusalem',
        depSched: '2027-01-12T02:30:00Z',
        arrSched: '2027-01-12T09:00:00Z',
      }),
    ]);
    expect(anchors.arrival).toEqual({ date: '2027-01-05', time: '11:30', flightHours: 8.5 });
    expect(anchors.departure).toEqual({ date: '2027-01-12', time: '09:30' });
  });

  it('with a connection, the last outbound leg lands and the hours count from the first take-off', () => {
    const anchors = flightAnchors([
      flight({
        id: 'a',
        arrIata: 'IST',
        arrTz: 'Europe/Istanbul',
        depSched: '2027-01-04T10:00:00Z',
        arrSched: '2027-01-04T12:00:00Z',
      }),
      flight({
        id: 'b',
        depIata: 'IST',
        depSched: '2027-01-04T15:00:00Z',
        arrSched: '2027-01-05T01:00:00Z',
      }),
    ]);
    expect(anchors.arrival).toMatchObject({ date: '2027-01-05', time: '08:00', flightHours: 15 });
  });

  it('no times: no anchors', () => {
    expect(flightAnchors([flight({})])).toEqual({ arrival: null, departure: null });
  });
});

describe('the board (AC-8, AC-12)', () => {
  const trip = { startDate: '2027-01-05', endDate: '2027-01-12' };
  const anchors = {
    arrival: { date: '2027-01-05', time: '14:55', flightHours: 7 },
    departure: { date: '2027-01-12', time: '09:30' },
  };

  it('a day per date, labelled by the shared rules, today marked, items in order', () => {
    const board = itineraryDays({
      trip,
      anchors,
      items: [item('b', '2027-01-06', 2048), item('a', '2027-01-06', 1024)],
      today: '2027-01-06',
    });
    expect(board.days).toHaveLength(8);
    expect(board.days[0]!.label).toEqual({ kind: 'arrival_short', time: '14:55' });
    expect(board.days[7]!.label).toEqual({ kind: 'departure_airport', time: '09:30' });
    expect(board.days[1]).toMatchObject({ index: 2, isToday: true, label: null });
    expect(board.days[1]!.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(boardCounts(board)).toEqual({ days: 8, planned: 1 });
    expect([...busyDays(board)]).toEqual(['2027-01-06']);
  });

  it('dates changed: items outside them are kept apart, never deleted', () => {
    const board = itineraryDays({
      trip,
      anchors,
      items: [item('x', '2027-01-20', 1024)],
      today: '2026-12-01',
    });
    expect(board.outOfRange.map((i) => i.id)).toEqual(['x']);
    expect(board.total).toBe(1);
  });

  it('no flights: no labels', () => {
    const board = itineraryDays({
      trip,
      anchors: { arrival: null, departure: null },
      items: [],
      today: '2026-12-01',
    });
    expect(board.days.every((d) => d.label === null)).toBe(true);
    expect(board.hasFlights).toBe(false);
  });

  it('up and down stop at the edges of a day', () => {
    const board = itineraryDays({
      trip,
      anchors,
      items: [item('a', '2027-01-06', 1), item('b', '2027-01-06', 2)],
      today: '2026-12-01',
    });
    const day = board.days[1]!;
    expect(moveWithinDay(day, 'a', -1)).toBeNull();
    expect(moveWithinDay(day, 'a', 1)).toBe(1);
    expect(moveWithinDay(day, 'b', 1)).toBeNull();
  });

  it('the planner covers 60 days at most (D16)', () => {
    expect(plannerEnd('2027-01-01', '2027-05-01')).toBe('2027-03-01');
    expect(plannerEnd('2027-01-01', '2027-01-08')).toBe('2027-01-08');
  });
});
