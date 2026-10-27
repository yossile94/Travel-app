import { assertEquals } from '@std/assert';

import type { FlightProvider, FlightSnapshot } from '../_shared/aerodatabox.ts';
import { lookup, normalizeFlightNumber, type LookupDeps } from './lookup.ts';

const leg = { number: 'LY541', isCargo: false } as FlightSnapshot;
const now = new Date('2026-10-27T08:00:00Z');

function deps(over: Partial<LookupDeps> = {}) {
  const calls: string[] = [];
  const provider: FlightProvider = {
    flightsByNumber: (n, d) => {
      calls.push(`${n}/${d}`);
      return Promise.resolve({ ok: true, value: [leg, { ...leg, isCargo: true }], units: 2 });
    },
    departures: () => Promise.reject(new Error('unused')),
  };
  return {
    calls,
    deps: {
      provider,
      tracked: () => Promise.resolve(null),
      takeSearch: () => Promise.resolve(true),
      spend: () => Promise.resolve(true),
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

Deno.test('a search asks the provider and drops cargo legs', async () => {
  const { deps: d, calls } = deps();
  const answer = await lookup(d, 'u', { number: 'ly 541', date: '2026-11-01' });
  assertEquals(answer, { status: 200, body: { legs: [leg], from: 'provider' } });
  assertEquals(calls, ['LY541/2026-11-01']);
});

Deno.test('a tracked flight checked in the last 30 minutes is free', async () => {
  const { deps: d, calls } = deps({
    tracked: () => Promise.resolve({ snapshot: leg, checkedAt: '2026-10-27T07:45:00Z' }),
    takeSearch: () => Promise.reject(new Error('must not take quota')),
  });
  const answer = await lookup(d, 'u', { number: 'LY541', date: '2026-11-01' });
  assertEquals(answer.status, 200);
  assertEquals(calls, []);
});

Deno.test(
  'the daily limit, the unit cap and a provider failure are answers, not errors',
  async () => {
    assertEquals(
      (
        await lookup(deps({ takeSearch: () => Promise.resolve(false) }).deps, 'u', {
          number: 'LY1',
          date: '2026-11-01',
        })
      ).body,
      { error: 'daily_limit' },
    );
    assertEquals(
      (
        await lookup(deps({ spend: () => Promise.resolve(false) }).deps, 'u', {
          number: 'LY1',
          date: '2026-11-01',
        })
      ).body,
      { error: 'budget' },
    );
    const failing = deps();
    failing.deps.provider.flightsByNumber = () =>
      Promise.resolve({ ok: false, status: 0, units: 2 });
    assertEquals((await lookup(failing.deps, 'u', { number: 'LY1', date: '2026-11-01' })).body, {
      error: 'provider',
    });
  },
);

Deno.test('bad input costs nothing', async () => {
  const { deps: d, calls } = deps({ takeSearch: () => Promise.reject(new Error('no quota')) });
  assertEquals((await lookup(d, 'u', { number: 'hello', date: '2026-11-01' })).status, 400);
  assertEquals((await lookup(d, 'u', { number: 'LY1', date: '2027-11-01' })).body, {
    error: 'bad_date',
  });
  assertEquals((await lookup(d, 'u', { number: 'LY1', date: '2026-10-20' })).body, {
    error: 'bad_date',
  });
  assertEquals(calls, []);
});
