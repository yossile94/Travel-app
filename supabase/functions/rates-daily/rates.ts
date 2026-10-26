/**
 * Daily exchange rates (sprint 4 F-012, ADR-008). Pure, so every rule is
 * tested:
 *   - USD/ILS always from the Bank of Israel (representative rate);
 *   - a currency the Bank of Israel publishes comes from it, per its `unit`
 *     (JPY is quoted per 100);
 *   - every other currency from ExchangeRate-API (X per USD), as a cross rate:
 *     rate_to_usd = 1 / X, rate_to_ils = rate_to_usd × USD/ILS.
 */

export interface BoiRate {
  key: string;
  currentExchangeRate: number;
  unit: number;
  lastUpdate: string;
}

export interface ErApiAnswer {
  result: string;
  time_last_update_unix: number;
  rates: Record<string, number>;
}

export interface RateRow {
  currency: string;
  rate_to_ils: number;
  rate_to_usd: number;
  source: 'boi' | 'erapi';
  rate_date: string;
}

const CODE = /^[A-Z]{3}$/;
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function ratesFrom(boi: BoiRate[], erapi: ErApiAnswer): RateRow[] {
  const usd = boi.find((r) => r.key === 'USD');
  if (!usd || !positive(usd.currentExchangeRate) || !positive(usd.unit)) {
    throw new Error('no USD/ILS from the Bank of Israel');
  }
  if (erapi.result !== 'success' || typeof erapi.rates !== 'object') {
    throw new Error('ExchangeRate-API did not answer');
  }
  const usdIls = usd.currentExchangeRate / usd.unit;
  const rows = new Map<string, RateRow>();

  for (const r of boi) {
    if (!CODE.test(r.key) || !positive(r.currentExchangeRate) || !positive(r.unit)) continue;
    const toIls = r.currentExchangeRate / r.unit;
    rows.set(r.key, {
      currency: r.key,
      rate_to_ils: toIls,
      rate_to_usd: toIls / usdIls,
      source: 'boi',
      rate_date: r.lastUpdate.slice(0, 10),
    });
  }

  const erDate = new Date(erapi.time_last_update_unix * 1000).toISOString().slice(0, 10);
  for (const [code, perUsd] of Object.entries(erapi.rates)) {
    if (!CODE.test(code) || rows.has(code) || code === 'ILS' || !positive(perUsd)) continue;
    const toUsd = 1 / perUsd;
    rows.set(code, {
      currency: code,
      rate_to_ils: toUsd * usdIls,
      rate_to_usd: toUsd,
      source: 'erapi',
      rate_date: erDate,
    });
  }
  return [...rows.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
