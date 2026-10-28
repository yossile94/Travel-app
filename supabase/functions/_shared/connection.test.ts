import { assert, assertEquals } from '@std/assert';

import { buildConnectionContent, connectionRisks, waitWords, type Around } from './connection.ts';
import { buildMessages, type ChangeEvent, type Target } from './push.ts';

const RLM = String.fromCharCode(0x200f);

// LY81 TLV→IST lands 01:25 IST (22:25Z); TK68 IST→BKK leaves 02:05 IST (23:05Z): 40 minutes.
const around = (over: Partial<Around> = {}): Around => ({
  flight_id: 'ly81',
  flight_number: 'LY81',
  flight_number_input: 'LY81',
  dep_iata: 'TLV',
  dep_tz: 'Asia/Jerusalem',
  arr_iata: 'IST',
  arr_tz: 'Europe/Istanbul',
  next_flight_id: 'tk68',
  next_number: 'TK68',
  next_dep: '2026-12-20T23:05:00.000Z',
  next_mct: 60,
  ...over,
});

Deno.test('wait in words (design 8.3), both languages', () => {
  const he: [number, string][] = [
    [1, 'דקה אחת'],
    [40, '40 דקות'],
    [60, 'שעה'],
    [61, 'שעה ודקה'],
    [75, 'שעה ו-15 דקות'],
    [120, 'שעתיים'],
    [121, 'שעתיים ודקה'],
    [150, 'שעתיים ו-30 דקות'],
    [180, '3 שעות'],
    [200, '3 שעות ו-20 דקות'],
  ];
  for (const [m, text] of he) assertEquals(waitWords(m, 'he'), text, String(m));
  const en: [number, string][] = [
    [1, '1 min'],
    [40, '40 min'],
    [60, '1 hr'],
    [61, '1 hr 1 min'],
    [120, '2 hr'],
    [200, '3 hr 20 min'],
  ];
  for (const [m, text] of en) assertEquals(waitWords(m, 'en'), text, String(m));
});

Deno.test('a later landing crosses the minimum: the alert, opening the next leg', () => {
  const risks = connectionRisks(
    null,
    { old: '2026-12-20T21:30:00.000Z', new: '2026-12-20T22:25:00.000Z' },
    around(),
  );
  assertEquals(risks.length, 1);
  assertEquals(risks[0]!.wait, 40);
  assertEquals(risks[0]!.nextFlightId, 'tk68');
  assertEquals(buildConnectionContent(risks[0]!, 'he', false), {
    title: `${RLM}הקונקשן ב-IST בסיכון`,
    body: `${RLM}זמן ההמתנה ירד ל-40 דקות. LY81 נוחתת ב-01:25 ו-TK68 ממריאה ב-02:05, שעון IST.`,
  });
  assertEquals(buildConnectionContent(risks[0]!, 'en', true), {
    title: 'Connection at IST at risk',
    body: 'Your layover is down to 40 min. LY81 lands at 01:25 and TK68 departs at 02:05, IST time. There are more changes.',
  });
});

Deno.test('no alert when the wait was already under the minimum, or stays over it', () => {
  const t = around();
  assertEquals(
    connectionRisks(null, { old: '2026-12-20T22:15:00.000Z', new: '2026-12-20T22:25:00.000Z' }, t),
    [],
  );
  assertEquals(
    connectionRisks(null, { old: '2026-12-20T21:00:00.000Z', new: '2026-12-20T21:30:00.000Z' }, t),
    [],
  );
});

Deno.test(
  'a next leg that leaves earlier: the wait before it crosses, past midnight says the day',
  () => {
    const t = around({
      flight_id: 'tk68',
      flight_number_input: 'TK68',
      dep_iata: 'IST',
      dep_tz: 'Europe/Istanbul',
      arr_iata: 'BKK',
      arr_tz: 'Asia/Bangkok',
      next_flight_id: null,
      prev_flight_id: 'ly81',
      prev_number: 'LY81',
      prev_arr: '2026-12-20T20:30:00.000Z',
      prev_arr_tz: 'Europe/Istanbul',
      prev_mct: 60,
    });
    const [risk] = connectionRisks(
      { old: '2026-12-20T22:00:00.000Z', new: '2026-12-20T20:20:00.000Z' },
      null,
      t,
    );
    assert(risk);
    assertEquals(risk.wait, -10);
    assertEquals(
      buildConnectionContent(risk, 'en', false).body,
      'You may miss TK68. LY81 lands at 23:30 and TK68 departs at 23:20, IST time.',
    );
    const late = buildConnectionContent(
      { ...risk, dep: '2026-12-20T21:10:00.000Z', wait: 40 },
      'he',
      false,
    );
    assertEquals(
      late.body,
      `${RLM}זמן ההמתנה ירד ל-40 דקות. LY81 נוחתת ב-23:30 ו-TK68 ממריאה ב-00:10 ב-21.12, שעון IST.`,
    );
  },
);

const target = (over: Partial<Target> = {}): Target => ({
  watch_id: 1,
  user_id: 'u',
  flight_id: 'ly81',
  flight_number: 'LY81',
  flight_number_input: 'LY81',
  dep_tz: 'Asia/Jerusalem',
  arr_tz: 'Europe/Istanbul',
  dep_iata: 'TLV',
  arr_iata: 'IST',
  dep_date_local: '2026-12-20',
  token_id: 10,
  token: 'ExponentPushToken[abcdefghijkl]',
  locale: 'en',
  next_flight_id: 'tk68',
  next_number: 'TK68',
  next_dep: '2026-12-20T23:05:00.000Z',
  next_mct: 60,
  ...over,
});
const later: ChangeEvent = {
  id: 1,
  watch_id: 1,
  field: 'arr_time',
  old_value: '2026-12-20T21:30:00.000Z',
  new_value: '2026-12-20T22:25:00.000Z',
};

Deno.test(
  'the connection alert replaces the regular one, once per device and next leg (Raz design 6)',
  () => {
    const seen = new Set<string>();
    const [first] = buildMessages([later], [target()], seen);
    assertEquals(first!.message.data, { v: 1, type: 'connection_risk', flightId: 'tk68' });
    assertEquals(first!.message.title, 'Connection at IST at risk');
    // The next leg's own change in the same run: no second alert for the same connection.
    const nextLeg = target({ watch_id: 2, flight_id: 'tk68', next_flight_id: null });
    const again = buildMessages(
      [{ ...later, id: 2, watch_id: 2 }],
      [{ ...nextLeg, prev_flight_id: 'ly81', next_flight_id: 'tk68' } as Target],
      seen,
    );
    assertEquals(again, []);
  },
);

Deno.test('cancelled stays "cancelled", never a connection alert (Raz design q2)', () => {
  const [m] = buildMessages(
    [later, { id: 2, watch_id: 1, field: 'status', old_value: null, new_value: 'Canceled' }],
    [target()],
  );
  assertEquals(m!.message.data.type, 'flight_change');
  assertEquals(m!.message.title, 'LY81 cancelled');
});

Deno.test('no booking code, trip name or seat in a connection alert', () => {
  const out = buildMessages(
    [later],
    [{ ...target(), pnr: 'ABC123', seat: '34A', trip: 'תאילנד' } as unknown as Target],
  );
  const text = JSON.stringify(out);
  for (const secret of ['ABC123', '34A', 'תאילנד']) assert(!text.includes(secret), secret);
});

// Raz review 1: both legs in one claim. MCT 60; A lands 10:00, B leaves 10:50 (already 50).
const claimTarget = (over: Partial<Target> = {}): Target =>
  target({
    flight_id: 'a',
    next_flight_id: 'b',
    next_watch_id: 2,
    next_number: 'TK68',
    next_dep: '2026-12-20T11:40:00.000Z',
    next_mct: 60,
    ...over,
  });
const aLater: ChangeEvent = {
  id: 1,
  watch_id: 1,
  field: 'arr_time',
  old_value: '2026-12-20T10:00:00.000Z',
  new_value: '2026-12-20T10:50:00.000Z',
};
const bLater = (oldValue: string): ChangeEvent => ({
  id: 2,
  watch_id: 2,
  field: 'dep_time',
  old_value: oldValue,
  new_value: '2026-12-20T11:40:00.000Z',
});
const claimOf = (events: ChangeEvent[]) => {
  const m = new Map<number, ChangeEvent[]>();
  for (const e of events) m.set(e.watch_id, [...(m.get(e.watch_id) ?? []), e]);
  return m;
};

Deno.test('both legs move together, already under the minimum: no alert (Raz review 1)', () => {
  const events = [aLater, bLater('2026-12-20T10:50:00.000Z')];
  const [m] = buildMessages([aLater], [claimTarget()], new Set(), claimOf(events));
  assertEquals(m!.message.data.type, 'flight_change');
});

Deno.test('both legs move and the wait crosses the minimum: the alert', () => {
  // Before: 10:00 → 11:30 is 90 min; after: 10:50 → 11:40 is 50 min.
  const events = [aLater, bLater('2026-12-20T11:30:00.000Z')];
  const [m] = buildMessages([aLater], [claimTarget()], new Set(), claimOf(events));
  assertEquals(m!.message.data, { v: 1, type: 'connection_risk', flightId: 'b' });
  assert(m!.message.body.includes('50 min'));
});

Deno.test('a middle leg: the earlier connection speaks, with more changes', () => {
  // B (IST→BKK) leaves earlier (90 → 40 min after A) and lands later (120 → 30 min before C).
  const t = claimTarget({
    flight_id: 'b',
    dep_iata: 'IST',
    dep_tz: 'Europe/Istanbul',
    arr_iata: 'BKK',
    arr_tz: 'Asia/Bangkok',
    prev_flight_id: 'a',
    prev_watch_id: 7,
    prev_number: 'LY81',
    prev_arr: '2026-12-20T10:00:00.000Z',
    prev_arr_tz: 'Europe/Istanbul',
    prev_mct: 60,
    next_flight_id: 'c',
    next_watch_id: 8,
    next_number: 'PG271',
    next_dep: '2026-12-20T22:00:00.000Z',
    next_mct: 60,
  });
  const earlier: ChangeEvent = {
    id: 5,
    watch_id: 1,
    field: 'dep_time',
    old_value: '2026-12-20T11:30:00.000Z',
    new_value: '2026-12-20T10:40:00.000Z',
  };
  const later: ChangeEvent = {
    id: 6,
    watch_id: 1,
    field: 'arr_time',
    old_value: '2026-12-20T20:00:00.000Z',
    new_value: '2026-12-20T21:30:00.000Z',
  };
  const [m] = buildMessages([earlier, later], [t]);
  assertEquals(m!.message.data, { v: 1, type: 'connection_risk', flightId: 'b' });
  assert(m!.message.body.endsWith('There are more changes.'));
});

Deno.test(
  "a connection alert already sent this run: the flight's gate change still goes (Raz review 6)",
  () => {
    const seen = new Set(['10:b']);
    const gate: ChangeEvent = {
      id: 3,
      watch_id: 1,
      field: 'dep_gate',
      old_value: 'B1',
      new_value: 'B2',
    };
    const [m] = buildMessages([aLater, gate], [claimTarget()], seen, claimOf([aLater]));
    assertEquals(m!.message.data.type, 'flight_change');
    assertEquals(m!.message.title, 'LY81 gate change');
  },
);

Deno.test(
  'a middle leg after its first connection already went: the second one still speaks (QA S7 #1)',
  () => {
    const t = claimTarget({
      flight_id: 'b',
      watch_id: 9,
      dep_iata: 'IST',
      dep_tz: 'Europe/Istanbul',
      arr_iata: 'BKK',
      arr_tz: 'Asia/Bangkok',
      prev_flight_id: 'a',
      prev_watch_id: 7,
      prev_number: 'LY81',
      prev_arr: '2026-12-20T10:00:00.000Z',
      prev_arr_tz: 'Europe/Istanbul',
      prev_mct: 60,
      next_flight_id: 'c',
      next_watch_id: 8,
      next_number: 'PG271',
      next_dep: '2026-12-20T22:00:00.000Z',
      next_mct: 60,
    });
    const events: ChangeEvent[] = [
      {
        id: 5,
        watch_id: 9,
        field: 'dep_time',
        old_value: '2026-12-20T11:30:00.000Z',
        new_value: '2026-12-20T10:40:00.000Z',
      },
      {
        id: 6,
        watch_id: 9,
        field: 'arr_time',
        old_value: '2026-12-20T20:00:00.000Z',
        new_value: '2026-12-20T21:30:00.000Z',
      },
    ];
    const [m] = buildMessages(events, [t], new Set(['10:b']));
    assertEquals(m!.message.data, { v: 1, type: 'connection_risk', flightId: 'c' });
    assert(m!.message.title.includes('BKK'));
  },
);
