import { assertEquals } from '@std/assert';

import type { FlightSnapshot, MovementTimes } from '../_shared/aerodatabox.ts';
import { pickFlights, verdict } from './coverage.ts';

const side = (over: Partial<MovementTimes> = {}): MovementTimes => ({
  iata: 'TLV',
  timeZone: 'Asia/Jerusalem',
  scheduledUtc: '2026-10-27T08:00:00.000Z',
  revisedUtc: null,
  predictedUtc: null,
  runwayUtc: null,
  terminal: null,
  gate: null,
  quality: ['Basic'],
  ...over,
});
const flight = (
  number: string,
  hour: number,
  over: Partial<FlightSnapshot> = {},
): FlightSnapshot => ({
  number,
  airlineIata: number.slice(0, 2),
  status: 'Expected',
  codeshareStatus: 'IsOperator',
  isCargo: false,
  departure: side({ scheduledUtc: `2026-10-27T${String(hour).padStart(2, '0')}:00:00.000Z` }),
  arrival: side({ iata: 'ATH' }),
  ...over,
});

Deno.test('picks five operated flights per airline, spread, after the earliest time', () => {
  const ly = Array.from({ length: 10 }, (_, i) => flight(`LY${i + 1}`, 6 + i));
  const departures = [
    ...ly,
    flight('6H1', 9),
    flight('6H2', 9, { codeshareStatus: 'IsCodeshared' }),
    flight('IZ1', 9, { status: 'Canceled' }),
    flight('IZ2', 3),
  ];
  const picked = pickFlights(departures, new Date('2026-10-27T05:00:00Z')).map((f) => f.number);
  assertEquals(picked, ['LY1', 'LY3', 'LY5', 'LY7', 'LY9', '6H1']);
});

Deno.test('a flight passes with a gate early and a departure after', () => {
  const early = flight('LY1', 8, { departure: side({ gate: 'B4' }) });
  const after = flight('LY1', 8, { status: 'Departed' });
  assertEquals(verdict({ early, after }), { live: true, departed: true, pass: true });
});

Deno.test('a schedule-only time is not live', () => {
  const early = flight('LY1', 8, { departure: side({ revisedUtc: '2026-10-27T08:00:00.000Z' }) });
  const late = flight('LY1', 8, {
    departure: side({ predictedUtc: '2026-10-27T08:20:00.000Z', quality: ['Basic', 'Live'] }),
  });
  assertEquals(verdict({ early, after: flight('LY1', 8) }).live, false);
  assertEquals(
    verdict({ late, after: flight('LY1', 8, { departure: side({ runwayUtc: 'x' }) }) }).pass,
    true,
  );
});

Deno.test('a missing probe fails the flight', () => {
  assertEquals(verdict({ early: null, late: null, after: null }).pass, false);
});
