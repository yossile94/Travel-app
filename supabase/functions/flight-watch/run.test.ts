import { assert, assertEquals, assertRejects } from '@std/assert';

import type { FlightProvider, FlightSnapshot, MovementTimes } from '../_shared/aerodatabox.ts';
import {
  buildMessages,
  leadEvent,
  buildContent,
  type ChangeEvent,
  type PushMessage,
  type Target,
} from '../_shared/push.ts';
import {
  checkFlights,
  readReceipts,
  sendAlerts,
  type Check,
  type Deps,
  type Watch,
} from './run.ts';

const side = (
  iata: string,
  tz: string,
  scheduledUtc: string,
  over: Partial<MovementTimes> = {},
): MovementTimes => ({
  iata,
  timeZone: tz,
  scheduledUtc,
  revisedUtc: null,
  predictedUtc: null,
  runwayUtc: null,
  terminal: null,
  gate: null,
  quality: ['Basic', 'Live'],
  ...over,
});
const DEP = '2026-11-01T20:00:00.000Z';
const ARR = '2026-11-02T06:00:00.000Z';
const snap = (dep: Partial<MovementTimes> = {}): FlightSnapshot => ({
  number: 'LY81',
  airlineIata: 'LY',
  airlineName: 'El Al',
  status: 'Expected',
  codeshareStatus: 'IsOperator',
  isCargo: false,
  departure: side('TLV', 'Asia/Jerusalem', DEP, dep),
  arrival: side('BKK', 'Asia/Bangkok', ARR),
});
const target = (over: Partial<Target> = {}): Target => ({
  watch_id: 1,
  user_id: 'u1',
  flight_id: 'f1',
  flight_number: 'LY81',
  dep_tz: 'Asia/Jerusalem',
  arr_tz: 'Asia/Bangkok',
  flight_number_input: 'LY81',
  dep_iata: 'TLV',
  arr_iata: 'BKK',
  dep_date_local: '2026-11-01',
  token_id: 10,
  token: 'ExponentPushToken[abcdefghijkl]',
  locale: 'he',
  ...over,
});

/** A small in-memory database with the same contract as the SQL functions. */
function fakeWorld(start: Date) {
  let clock = start.getTime();
  let provider: FlightSnapshot = snap();
  const sent: { at: number; messages: PushMessage[] }[] = [];
  const watch: Watch & { state: string; next_check_at: string | null } = {
    id: 1,
    flight_number: 'LY81',
    dep_date_local: '2026-11-01',
    sched_dep_utc: DEP,
    sched_arr_utc: ARR,
    attempts: 0,
    last_notified: null,
    locked_until: '',
    state: 'active',
    next_check_at: new Date(start.getTime()).toISOString(),
  };
  const events: (ChangeEvent & { sent: boolean; claimedAt: number | null; detectedAt: number })[] =
    [];
  let nextId = 1;
  const deps: Deps = {
    now: () => new Date(clock),
    sleep: () => Promise.resolve(),
    log: () => {},
    provider: {
      flightsByNumber: () => Promise.resolve({ ok: true, value: [provider], units: 2 }),
      departures: () => Promise.reject(new Error('unused')),
    } as FlightProvider,
    push: {
      send: (messages) => {
        sent.push({ at: clock, messages });
        return Promise.resolve({
          ok: true,
          tickets: messages.map((_, i) => ({ status: 'ok' as const, id: `t${sent.length}-${i}` })),
        });
      },
      receipts: () => Promise.resolve({}),
    },
    db: {
      claimWatches: () => {
        if (
          watch.state !== 'active' ||
          !watch.next_check_at ||
          Date.parse(watch.next_check_at) > clock
        ) {
          return Promise.resolve([]);
        }
        watch.locked_until = new Date(clock + 300_000).toISOString();
        return Promise.resolve([{ ...watch }]);
      },
      spend: () => Promise.resolve(true),
      apply: (_w: Watch, c: Check) => {
        watch.state = c.state;
        watch.next_check_at = c.next;
        if (c.notified) watch.last_notified = c.notified;
        const ids: number[] = [];
        for (const e of (c.events ?? []) as {
          field: ChangeEvent['field'];
          old: string;
          new: string;
        }[]) {
          const id = nextId++;
          events.push({
            id,
            watch_id: 1,
            field: e.field,
            old_value: e.old,
            new_value: e.new,
            sent: false,
            claimedAt: null,
            detectedAt: clock,
          });
          ids.push(id);
        }
        return Promise.resolve(ids);
      },
      claimNotifications: () => {
        const due = events.filter(
          (e) => !e.sent && (e.claimedAt === null || clock - e.claimedAt > 600_000),
        );
        due.forEach((e) => (e.claimedAt = clock));
        return Promise.resolve(
          due.map(({ id, watch_id, field, old_value, new_value }) => ({
            id,
            watch_id,
            field,
            old_value,
            new_value,
          })),
        );
      },
      targets: (_watchId, after) => Promise.resolve(after === 0 ? [target()] : []),
      markSent: (ids) => {
        events.filter((e) => ids.includes(e.id)).forEach((e) => (e.sent = true));
        return Promise.resolve();
      },
      release: (ids) => {
        events.filter((e) => ids.includes(e.id)).forEach((e) => (e.claimedAt = null));
        return Promise.resolve();
      },
      deleteTokens: () => Promise.resolve(),
      oldReceipts: () => Promise.resolve([]),
      dropReceipts: () => Promise.resolve(),
    },
  };
  return {
    deps,
    sent,
    events,
    watch,
    advance: (ms: number) => (clock += ms),
    setProvider: (s: FlightSnapshot) => (provider = s),
    clock: () => clock,
  };
}

/** The cron: a run each minute. */
async function runMinutes(w: ReturnType<typeof fakeWorld>, minutes: number) {
  for (let i = 0; i < minutes; i++) {
    await checkFlights(w.deps);
    await sendAlerts(w.deps);
    w.advance(60_000);
  }
}

Deno.test(
  'AC-4: a delay reaches Expo within 20 minutes, wherever it lands in the window',
  async () => {
    // A change at every minute offset within one 15-minute check cycle.
    for (let offset = 0; offset < 15; offset++) {
      const w = fakeWorld(new Date('2026-11-01T15:00:00Z'));
      await runMinutes(w, 1); // first check: nothing changed
      w.advance(offset * 60_000);
      const changedAt = w.clock();
      w.setProvider(snap({ revisedUtc: '2026-11-01T21:30:00.000Z' }));
      await runMinutes(w, 20);
      assertEquals(w.sent.length, 1, `offset ${offset}`);
      assert(
        w.sent[0]!.at - changedAt <= 20 * 60_000,
        `offset ${offset}: ${(w.sent[0]!.at - changedAt) / 60_000} min`,
      );
    }
  },
);

Deno.test('AC-6: an alert is sent once, even when runs repeat', async () => {
  const w = fakeWorld(new Date('2026-11-01T15:00:00Z'));
  await runMinutes(w, 1);
  w.setProvider(snap({ revisedUtc: '2026-11-01T21:30:00.000Z', gate: 'B4' }));
  await runMinutes(w, 40);
  assertEquals(w.sent.length, 1);
  assertEquals(w.sent[0]!.messages.length, 1);
});

Deno.test('a failed send is retried by the next run after the claim lapses', async () => {
  const w = fakeWorld(new Date('2026-11-01T15:00:00Z'));
  await runMinutes(w, 1);
  w.setProvider(snap({ revisedUtc: '2026-11-01T21:30:00.000Z' }));
  const real = w.deps.push.send;
  let fail = true;
  w.deps.push.send = (m) =>
    fail ? ((fail = false), Promise.resolve({ ok: false as const, status: 400 })) : real(m);
  await runMinutes(w, 25);
  assertEquals(w.sent.length, 1);
});

Deno.test(
  'one alert per flight per check: the lead change speaks, with "more changes" (Raz 2)',
  () => {
    const events: ChangeEvent[] = [
      { id: 1, watch_id: 1, field: 'dep_gate', old_value: 'B4', new_value: 'C2' },
      {
        id: 2,
        watch_id: 1,
        field: 'dep_time',
        old_value: DEP,
        new_value: '2026-11-01T21:30:00.000Z',
      },
    ];
    assertEquals(leadEvent(events).field, 'dep_time');
    const out = buildMessages(events, [
      target(),
      target({ token_id: 11, token: 'ExponentPushToken[mnopqrstuvwx]', locale: 'en' }),
    ]);
    assertEquals(out.length, 2);
    assertEquals(out[0]!.message.title, '\u200FLY81 נדחתה');
    assertEquals(
      out[0]!.message.body,
      '\u200Fהמראה חדשה: 23:30, שעון TLV. במקום 22:00. יש עוד שינויים בטיסה.',
    );
    assertEquals(out[1]!.message.title, 'LY81 delayed');
    assertEquals(
      out[1]!.message.body,
      'New departure: 23:30, TLV time. Was 22:00. There are more changes.',
    );
    assertEquals(out[0]!.message.data, { v: 1, type: 'flight_change', flightId: 'f1' });
    assertEquals(out[0]!.message.channelId, 'flight-changes');
  },
);

Deno.test('alert texts (design 3.2): another day, cancelled, a first gate, arrival earlier', () => {
  const t = target();
  const late = buildContent(
    {
      id: 1,
      watch_id: 1,
      field: 'dep_time',
      old_value: DEP,
      new_value: '2026-11-01T23:10:00.000Z',
    },
    t,
    false,
  );
  assertEquals(late.body, '\u200Fהמראה חדשה: 01:10 ב-2.11, שעון TLV. במקום 22:00.');
  const cancelled = buildContent(
    { id: 1, watch_id: 1, field: 'status', old_value: null, new_value: 'Canceled' },
    t,
    true,
  );
  assertEquals(cancelled.title, '\u200FLY81 בוטלה');
  assertEquals(cancelled.body, '\u200Fהטיסה מ-TLV ל-BKK ב-1.11 בוטלה. כדאי לבדוק מול חברת התעופה.');
  const gate = buildContent(
    { id: 1, watch_id: 1, field: 'dep_gate', old_value: null, new_value: 'C2' },
    target({ locale: 'en' }),
    false,
  );
  assertEquals(gate, { title: 'LY81 gate change', body: 'Departure gate: C2.' });
  const arr = buildContent(
    {
      id: 1,
      watch_id: 1,
      field: 'arr_time',
      old_value: ARR,
      new_value: '2026-11-02T05:30:00.000Z',
    },
    target({ locale: 'en' }),
    false,
  );
  assertEquals(arr, {
    title: 'LY81 arrives earlier',
    body: 'New arrival: 12:30, BKK time. Was 13:00.',
  });
});

Deno.test('a delay that also moves the arrival is one change, not "more changes" (Raz 3)', () => {
  const out = buildMessages(
    [
      {
        id: 1,
        watch_id: 1,
        field: 'arr_time',
        old_value: ARR,
        new_value: '2026-11-02T07:30:00.000Z',
      },
      {
        id: 2,
        watch_id: 1,
        field: 'dep_time',
        old_value: DEP,
        new_value: '2026-11-01T21:30:00.000Z',
      },
    ],
    [target({ locale: 'en', flight_number_input: 'ly 81' })],
  );
  assertEquals(out[0]!.message.title, 'ly 81 delayed');
  assertEquals(out[0]!.message.body, 'New departure: 23:30, TLV time. Was 22:00.');
});

Deno.test('diverted with no known destination still reads whole (Raz 2)', () => {
  const e: ChangeEvent = {
    id: 1,
    watch_id: 1,
    field: 'status',
    old_value: null,
    new_value: 'Diverted',
  };
  assertEquals(
    buildContent(e, target({ locale: 'en' }), false).body,
    "It won't land at BKK as planned.",
  );
  assertEquals(
    buildContent(e, target({ locale: 'en', arr_iata: null }), false).body,
    "It won't land at its destination as planned.",
  );
});

Deno.test('no booking code, trip name or seat ever reaches an alert', () => {
  const out = buildMessages(
    [
      {
        id: 1,
        watch_id: 1,
        field: 'dep_time',
        old_value: DEP,
        new_value: '2026-11-01T21:30:00.000Z',
      },
    ],
    [{ ...target(), pnr: 'ABC123', seat: '34A', trip: 'תאילנד' } as unknown as Target],
  );
  const text = JSON.stringify(out);
  for (const secret of ['ABC123', '34A', 'תאילנד']) assert(!text.includes(secret), secret);
});

Deno.test(
  'a failed send is released and goes on the next run, a minute later (Dudi 2)',
  async () => {
    const w = fakeWorld(new Date('2026-11-01T15:00:00Z'));
    await runMinutes(w, 1);
    w.setProvider(snap({ revisedUtc: '2026-11-01T21:30:00.000Z' }));
    const real = w.deps.push.send;
    let fail = true;
    w.deps.push.send = (m) =>
      fail ? ((fail = false), Promise.resolve({ ok: false as const, status: 400 })) : real(m);
    w.advance(15 * 60_000);
    await checkFlights(w.deps);
    assertEquals(w.events.length, 1);
    const changed = w.clock();
    await sendAlerts(w.deps);
    w.advance(60_000);
    await sendAlerts(w.deps);
    assertEquals(w.sent.length, 1);
    assert(w.sent[0]!.at - changed <= 60_000);
  },
);

Deno.test(
  'more than one page of recipients: every device gets it, in batches of 100 (Dudi 1)',
  async () => {
    const w = fakeWorld(new Date('2026-11-01T15:00:00Z'));
    const all = Array.from({ length: 1234 }, (_, i) =>
      target({ token_id: i + 1, token: `ExponentPushToken[${i}]` }),
    );
    w.deps.db.targets = (_id, after, limit) =>
      Promise.resolve(all.filter((t) => t.token_id > after).slice(0, limit));
    let marked = 0;
    w.deps.db.markSent = (ids) => ((marked += ids.length), Promise.resolve());
    w.deps.db.claimNotifications = () =>
      Promise.resolve([
        { id: 1, watch_id: 1, field: 'dep_gate', old_value: 'B1', new_value: 'B2' },
      ]);
    assertEquals(await sendAlerts(w.deps), { sent: 1234 });
    assertEquals(w.sent.length, 13);
    assert(w.sent.every((b) => b.messages.length <= 100));
    assertEquals(marked, 1);
  },
);

Deno.test('a failed mark stops the run: nothing goes on unmarked (Dudi 2)', async () => {
  const w = fakeWorld(new Date('2026-11-01T15:00:00Z'));
  w.deps.db.claimNotifications = () =>
    Promise.resolve([
      { id: 1, watch_id: 1, field: 'dep_gate', old_value: 'B1', new_value: 'B2' },
      { id: 2, watch_id: 2, field: 'dep_gate', old_value: 'C1', new_value: 'C2' },
    ]);
  w.deps.db.targets = (watchId, after) =>
    Promise.resolve(after === 0 ? [target({ watch_id: watchId })] : []);
  w.deps.db.markSent = () => Promise.reject(new Error('mark failed'));
  await assertRejects(() => sendAlerts(w.deps));
  assertEquals(w.sent.length, 1);
});

Deno.test('two checks unsent: the alert says the latest time, instead of the first old one', () => {
  const lead = leadEvent([
    {
      id: 1,
      watch_id: 1,
      field: 'dep_time',
      old_value: DEP,
      new_value: '2026-11-01T21:30:00.000Z',
    },
    {
      id: 2,
      watch_id: 1,
      field: 'dep_time',
      old_value: '2026-11-01T21:30:00.000Z',
      new_value: '2026-11-01T22:00:00.000Z',
    },
  ]);
  assertEquals(lead.new_value, '2026-11-01T22:00:00.000Z');
  assertEquals(lead.old_value, DEP);
});

Deno.test('a timeout is not retried: Expo may already have it', async () => {
  const w = fakeWorld(new Date('2026-11-01T15:00:00Z'));
  let calls = 0;
  w.deps.push.send = () => (calls++, Promise.resolve({ ok: false as const, status: 0 }));
  w.deps.db.claimNotifications = () =>
    Promise.resolve([{ id: 1, watch_id: 1, field: 'dep_gate', old_value: 'B1', new_value: 'B2' }]);
  await sendAlerts(w.deps);
  assertEquals(calls, 1);
});

Deno.test(
  'a page that fails to read: what went is marked, the rest released (Dudi re-review 1)',
  async () => {
    const w = fakeWorld(new Date('2026-11-01T15:00:00Z'));
    const all = Array.from({ length: 600 }, (_, i) =>
      target({ token_id: i + 1, token: 'ExponentPushToken[' + i + ']' }),
    );
    w.deps.db.claimNotifications = () =>
      Promise.resolve([
        { id: 1, watch_id: 1, field: 'dep_gate', old_value: 'B1', new_value: 'B2' },
        { id: 2, watch_id: 2, field: 'dep_gate', old_value: 'C1', new_value: 'C2' },
      ]);
    w.deps.db.targets = (_id, after, limit) =>
      after === 0 ? Promise.resolve(all.slice(0, limit)) : Promise.reject(new Error('read failed'));
    const marked: number[] = [];
    const released: number[] = [];
    w.deps.db.markSent = (ids) => (marked.push(...ids), Promise.resolve());
    w.deps.db.release = (ids) => (released.push(...ids), Promise.resolve());
    await assertRejects(() => sendAlerts(w.deps));
    assertEquals(marked, [1]);
    assertEquals(released, [2]);
  },
);

Deno.test('receipts: a dead device is dropped', async () => {
  const w = fakeWorld(new Date('2026-11-01T15:00:00Z'));
  const deleted: number[][] = [];
  w.deps.db.oldReceipts = () =>
    Promise.resolve([
      { ticket_id: 'a', token_id: 10 },
      { ticket_id: 'b', token_id: 11 },
    ]);
  w.deps.db.deleteTokens = (ids) => (deleted.push(ids), Promise.resolve());
  w.deps.push.receipts = () =>
    Promise.resolve({
      a: { status: 'ok' as const },
      b: { status: 'error' as const, details: { error: 'DeviceNotRegistered' } },
    });
  assertEquals(await readReceipts(w.deps), { read: 2, dropped: 1 });
  assertEquals(deleted, [[11]]);
});
