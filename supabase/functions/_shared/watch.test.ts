import { assertEquals } from '@std/assert';

import type { FlightSnapshot, MovementTimes } from './aerodatabox.ts';
import { backoff, detectChanges, pickLeg, planAfter } from './watch.ts';

const side = (over: Partial<MovementTimes> = {}): MovementTimes => ({
  iata: 'TLV',
  timeZone: 'Asia/Jerusalem',
  scheduledUtc: '2026-11-01T10:00:00.000Z',
  revisedUtc: null,
  predictedUtc: null,
  runwayUtc: null,
  terminal: '3',
  gate: null,
  quality: ['Basic', 'Live'],
  ...over,
});
const snap = (over: Partial<FlightSnapshot> = {}): FlightSnapshot => ({
  number: 'LY541',
  airlineIata: 'LY',
  airlineName: null,
  status: 'Expected',
  codeshareStatus: 'IsOperator',
  isCargo: false,
  departure: side(),
  arrival: side({ iata: 'ATH', scheduledUtc: '2026-11-01T12:00:00.000Z' }),
  ...over,
});
const sched = { dep: '2026-11-01T10:00:00.000Z', arr: '2026-11-01T12:00:00.000Z' };

Deno.test('a first estimate under 15 minutes from the schedule is not a change', () => {
  const r = detectChanges(
    null,
    snap({ departure: side({ revisedUtc: '2026-11-01T10:10:00.000Z' }) }),
    sched,
  );
  assertEquals(r.events, []);
  assertEquals(r.notified.depTime, sched.dep);
});

Deno.test('15 minutes or more is a change, compared with the last shown value', () => {
  const first = detectChanges(
    null,
    snap({ departure: side({ revisedUtc: '2026-11-01T10:20:00.000Z' }) }),
    sched,
  );
  assertEquals(first.events, [
    { field: 'dep_time', old: sched.dep, new: '2026-11-01T10:20:00.000Z' },
  ]);
  // 10 more minutes against the last shown value: not yet; 15 against it: yes.
  const small = detectChanges(
    first.notified,
    snap({ departure: side({ revisedUtc: '2026-11-01T10:30:00.000Z' }) }),
    sched,
  );
  assertEquals(small.events, []);
  const creep = detectChanges(
    small.notified,
    snap({ departure: side({ revisedUtc: '2026-11-01T10:35:00.000Z' }) }),
    sched,
  );
  assertEquals(creep.events.length, 1);
});

Deno.test('a first gate is an update, a gate change is a change', () => {
  const first = detectChanges(null, snap({ departure: side({ gate: 'B4' }) }), sched);
  assertEquals(first.events, []);
  assertEquals(first.notified.depGate, 'B4');
  const moved = detectChanges(first.notified, snap({ departure: side({ gate: 'C2' }) }), sched);
  assertEquals(moved.events, [{ field: 'dep_gate', old: 'B4', new: 'C2' }]);
});

Deno.test('cancelled and diverted are changes; other statuses are not', () => {
  assertEquals(detectChanges(null, snap({ status: 'Boarding' }), sched).events, []);
  const c = detectChanges(null, snap({ status: 'Canceled' }), sched);
  assertEquals(c.events, [{ field: 'status', old: null, new: 'Canceled' }]);
  assertEquals(detectChanges(c.notified, snap({ status: 'Canceled' }), sched).events, []);
});

Deno.test('plan: wait for the 6-hour window, then every 15 minutes', () => {
  const early = planAfter(snap(), new Date('2026-11-01T00:00:00Z'));
  assertEquals(early, { state: 'active', next: '2026-11-01T04:00:00.000Z' });
  const close = planAfter(snap(), new Date('2026-11-01T08:00:00Z'));
  assertEquals(close, { state: 'active', next: '2026-11-01T08:15:00.000Z' });
});

Deno.test('plan: while flying, next at the expected arrival, at most an hour away', () => {
  const p = planAfter(snap({ status: 'EnRoute' }), new Date('2026-11-01T10:30:00Z'));
  assertEquals(p, { state: 'active', next: '2026-11-01T11:30:00.000Z' });
  const near = planAfter(snap({ status: 'EnRoute' }), new Date('2026-11-01T11:30:00Z'));
  assertEquals(near, { state: 'active', next: '2026-11-01T12:05:00.000Z' });
});

Deno.test('plan: landed, cancelled, or a day past a departure with no arrival stops', () => {
  const landed = planAfter(
    snap({
      status: 'Arrived',
      arrival: side({ iata: 'ATH', runwayUtc: '2026-11-01T12:07:00.000Z' }),
    }),
    new Date('2026-11-01T12:20:00Z'),
  );
  assertEquals(landed, { state: 'stopped', landedAt: '2026-11-01T12:07:00.000Z' });
  assertEquals(
    planAfter(snap({ status: 'Canceled' }), new Date('2026-11-01T08:00:00Z')).state,
    'stopped',
  );
  const noArrival = snap({ arrival: side({ iata: 'ATH', scheduledUtc: null }) });
  assertEquals(planAfter(noArrival, new Date('2026-11-02T10:01:00Z')).state, 'stopped');
});

Deno.test('backoff doubles from 5 minutes and stops growing', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  assertEquals(backoff(0, now), '2026-11-01T00:05:00.000Z');
  assertEquals(backoff(2, now), '2026-11-01T00:20:00.000Z');
  assertEquals(backoff(9, now), '2026-11-01T01:20:00.000Z');
});

Deno.test('the tracked leg is the one nearest the scheduled departure', () => {
  const a = snap({ departure: side({ scheduledUtc: '2026-11-01T04:00:00.000Z' }) });
  const b = snap();
  assertEquals(pickLeg([a, b], sched.dep), b);
  assertEquals(pickLeg([a], null), a);
  assertEquals(pickLeg([], sched.dep), null);
});
