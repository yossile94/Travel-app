import { assertAlmostEquals, assertEquals, assertThrows } from '@std/assert';

import { ratesFrom, type BoiRate, type ErApiAnswer } from './rates.ts';

const boi: BoiRate[] = [
  { key: 'USD', currentExchangeRate: 3.078, unit: 1, lastUpdate: '2026-10-26T13:22:03Z' },
  { key: 'EUR', currentExchangeRate: 3.4462, unit: 1, lastUpdate: '2026-10-26T13:22:03Z' },
  { key: 'JPY', currentExchangeRate: 1.9557, unit: 100, lastUpdate: '2026-10-26T13:22:03Z' },
];
const erapi: ErApiAnswer = {
  result: 'success',
  time_last_update_unix: Date.UTC(2026, 9, 26) / 1000,
  rates: { USD: 1, EUR: 0.9, JPY: 150, THB: 32.4, VND: 25000, ILS: 3.1, xx: 1, BAD: -1 },
};

Deno.test('USD/ILS and the Bank of Israel currencies come from the Bank of Israel', () => {
  const rows = ratesFrom(boi, erapi);
  const eur = rows.find((r) => r.currency === 'EUR')!;
  assertEquals(eur.source, 'boi');
  assertAlmostEquals(eur.rate_to_ils, 3.4462);
  assertAlmostEquals(eur.rate_to_usd, 3.4462 / 3.078);
  assertEquals(rows.find((r) => r.currency === 'USD')!.rate_to_usd, 1);
});

Deno.test('a Bank of Israel unit of 100 is normalised (JPY)', () => {
  const jpy = ratesFrom(boi, erapi).find((r) => r.currency === 'JPY')!;
  assertAlmostEquals(jpy.rate_to_ils, 0.019557);
});

Deno.test('other currencies are a cross rate through USD', () => {
  const rows = ratesFrom(boi, erapi);
  const thb = rows.find((r) => r.currency === 'THB')!;
  assertEquals(thb.source, 'erapi');
  assertAlmostEquals(thb.rate_to_usd, 1 / 32.4);
  assertAlmostEquals(thb.rate_to_ils, 3.078 / 32.4);
  assertEquals(thb.rate_date, '2026-10-26');
});

Deno.test('ILS, bad codes and bad values are left out', () => {
  const codes = ratesFrom(boi, erapi).map((r) => r.currency);
  assertEquals(codes, ['EUR', 'JPY', 'THB', 'USD', 'VND']);
});

Deno.test('no USD from the Bank of Israel, or no answer from ER-API: the run fails', () => {
  assertThrows(() => ratesFrom(boi.slice(1), erapi));
  assertThrows(() => ratesFrom(boi, { ...erapi, result: 'error' }));
});
