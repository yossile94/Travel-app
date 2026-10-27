import { assertEquals } from '@std/assert';

import type { FlightSnapshot, MovementTimes } from '../_shared/aerodatabox.ts';
import { gateResult, pickFlights, retryAt, tlvDate, verdict } from './coverage.ts';

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
  airlineName: null,
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

Deno.test('the local date at TLV, across midnight', () => {
  assertEquals(tlvDate('2026-10-27T21:30:00.000Z'), '2026-10-27');
  assertEquals(tlvDate('2026-10-27T22:30:00.000Z'), '2026-10-28');
});

Deno.test(
  'a flight delayed past the +30 probe gets one more, 30 minutes after its new time',
  () => {
    const late = flight('LY1', 8, {
      status: 'Delayed',
      departure: side({ revisedUtc: '2026-10-27T09:10:00.000Z' }),
    });
    assertEquals(retryAt(late, new Date('2026-10-27T08:30:00Z')), '2026-10-27T09:40:00.000Z');
    assertEquals(
      retryAt(flight('LY1', 8, { status: 'Departed' }), new Date('2026-10-27T08:30:00Z')),
      null,
    );
    assertEquals(retryAt(flight('LY1', 8), new Date('2026-10-27T08:30:00Z')), null);
  },
);

Deno.test('the gate counts passes, leaves cancelled flights out, and departs on the retry', () => {
  const gate = flight('X', 8, { departure: side({ gate: 'B4' }) });
  const rows = [
    { flight_number: 'LY1', probe_kind: 'early' as const, snapshot: gate },
    {
      flight_number: 'LY1',
      probe_kind: 'after' as const,
      snapshot: flight('LY1', 8, { status: 'Delayed' }),
    },
    {
      flight_number: 'LY1',
      probe_kind: 'retry' as const,
      snapshot: flight('LY1', 8, { status: 'Departed' }),
    },
    {
      flight_number: 'IZ1',
      probe_kind: 'early' as const,
      snapshot: flight('IZ1', 8, { status: 'Canceled' }),
    },
    { flight_number: '6H1', probe_kind: 'early' as const, snapshot: null },
  ];
  const result = gateResult(rows);
  assertEquals([result.counted, result.passed, result.gate], [2, 1, false]);
});
