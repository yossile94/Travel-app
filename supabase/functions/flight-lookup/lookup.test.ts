import { assertEquals } from '@std/assert';

import type { FlightProvider, FlightSnapshot } from '../_shared/aerodatabox.ts';
import { type Begin, lookup, normalizeFlightNumber, type LookupDeps } from './lookup.ts';

const leg = { number: 'LY541', isCargo: false } as FlightSnapshot;
const now = new Date('2026-10-27T08:00:00Z');
const body = { number: 'LY541', date: '2026-11-01' };

function deps(begin: Begin = { status: 'go' }, over: Partial<LookupDeps> = {}) {
  const calls: string[] = [];
  const kept: string[] = [];
  const begun: unknown[][] = [];
  const provider: FlightProvider = {
    flightsByNumber: (n, d) => {
      calls.push(`${n}/${d}`);
      return Promise.resolve({ ok: true, value: [leg, { ...leg, isCargo: true }], units: 2 });
    },
    departures: () => Promise.reject(new Error('unused')),
  };
  return {
    calls,
    kept,
    begun,
    deps: {
      provider,
      begin: (...a) => {
        begun.push(a);
        return Promise.resolve(begin);
      },
      remember: (n, d, legs) => {
        kept.push(`${n}/${d}/${legs.length}`);
        return Promise.resolve();
      },
      now: () => now,
      ...over,
    } as LookupDeps,
  };
}

Deno.test('flight numbers are normalised: no space, upper case, no leading zeros', () => {
  assertEquals(normalizeFlightNumber('ly 0081'), 'LY81');
  assertEquals(normalizeFlightNumber('6H 7'), '6H7');
  assertEquals(normalizeFlightNumber('IZ12345'), null);
  assertEquals(normalizeFlightNumber('L'), null);
  assertEquals(normalizeFlightNumber('LY0'), null);
});

Deno.test('a search asks the provider, drops cargo legs and keeps the answer', async () => {
  const { deps: d, calls, kept, begun } = deps();
  const answer = await lookup(d, 'u', { number: 'ly 541', date: '2026-11-01' });
  assertEquals(answer, { status: 200, body: { legs: [leg], from: 'provider' } });
  assertEquals(begun, [['u', 'LY541', '2026-11-01', 2]]);
  assertEquals(calls, ['LY541/2026-11-01']);
  assertEquals(kept, ['LY541/2026-11-01/1']);
});

Deno.test('AC-7: "not found" is kept too', async () => {
  const { deps: d, kept } = deps();
  d.provider.flightsByNumber = () => Promise.resolve({ ok: true, value: [], units: 2 });
  assertEquals((await lookup(d, 'u', body)).body, { legs: [], from: 'provider' });
  assertEquals(kept, ['LY541/2026-11-01/0']);
});

Deno.test('AC-7: a copy answers without the provider, every leg', async () => {
  const second = { ...leg, number: 'LY542' } as FlightSnapshot;
  for (const from of ['tracked', 'cache'] as const) {
    const { deps: d, calls, kept } = deps({ status: 'copy', from, legs: [leg, second] });
    assertEquals(await lookup(d, 'u', body), {
      status: 200,
      body: { legs: [leg, second], from },
    });
    assertEquals(calls, []);
    assertEquals(kept, []);
  }
});

Deno.test('AC-7: the caps answer 429 with the reason', async () => {
  for (const reason of ['lookups_day', 'lookups_30d'] as const) {
    const { deps: d, calls } = deps({ status: reason });
    assertEquals(await lookup(d, 'u', body), {
      status: 429,
      body: { error: 'rate_limited', reason },
    });
    assertEquals(calls, []);
  }
});

Deno.test('design 6.3: a suspended account gets 403 suspended', async () => {
  const { deps: d, calls } = deps({ status: 'suspended' });
  assertEquals(await lookup(d, 'u', body), { status: 403, body: { error: 'suspended' } });
  assertEquals(calls, []);
});

Deno.test('a full budget or a busy provider budget is "budget"', async () => {
  for (const status of ['off', 'budget'] as const) {
    const { deps: d, calls } = deps({ status });
    assertEquals(await lookup(d, 'u', body), { status: 503, body: { error: 'budget' } });
    assertEquals(calls, []);
  }
});

Deno.test('AC-8: a database that did not answer is "provider", not a cap', async () => {
  const { deps: d, calls } = deps({ status: 'error' });
  assertEquals(await lookup(d, 'u', body), { status: 503, body: { error: 'provider' } });
  assertEquals(calls, []);
});

Deno.test('a provider failure is "provider" and is not kept', async () => {
  const { deps: d, kept } = deps();
  d.provider.flightsByNumber = () => Promise.resolve({ ok: false, status: 0, units: 2 });
  assertEquals((await lookup(d, 'u', body)).body, { error: 'provider' });
  assertEquals(kept, []);
});

Deno.test('bad input costs nothing', async () => {
  const { deps: d, calls, begun } = deps();
  assertEquals((await lookup(d, 'u', { number: 'hello', date: '2026-11-01' })).status, 400);
  assertEquals((await lookup(d, 'u', { number: 'LY1', date: '2027-11-01' })).body, {
    error: 'bad_date',
  });
  assertEquals((await lookup(d, 'u', { number: 'LY1', date: '2026-10-20' })).body, {
    error: 'bad_date',
  });
  assertEquals(calls, []);
  assertEquals(begun, []);
});
