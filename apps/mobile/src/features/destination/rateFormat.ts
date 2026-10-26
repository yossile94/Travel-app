/**
 * How an exchange rate is shown (sprint 4 F-012, AC-1): "1,000 VND = 0.12 ₪ · 0.04 $".
 *   - the amount of local currency is 1, 10, 100, 1,000 or 10,000: the
 *     smallest whose value in shekels is at least 0.1;
 *   - the values are rounded to 2 significant digits;
 *   - ILS has no line; USD shows only the shekels.
 * Pure, so every rule is unit-tested (EUR, THB, JPY, VND, IDR).
 */

export interface Rate {
  currency: string;
  rateToIls: number;
  rateToUsd: number;
  source: 'boi' | 'erapi';
  rateDate: string;
  fetchedAt: string;
}

const UNITS = [1, 10, 100, 1000, 10000];

/** The amount of local currency the line shows. */
export function unitFor(rateToIls: number): number {
  return UNITS.find((u) => u * rateToIls >= 0.1) ?? UNITS[UNITS.length - 1]!;
}

/** Two significant digits, without exponent notation, with thousands separators. */
export function twoSignificant(value: number): string {
  if (!(value > 0)) return '0';
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  const rounded = Math.round(value / step) * step;
  // Rounding can add a digit (0.0995 → 0.10): the decimals follow the rounded value.
  const decimals = Math.max(0, 1 - Math.floor(Math.log10(rounded)));
  return groupThousands(rounded.toFixed(decimals));
}

function groupThousands(text: string): string {
  const [whole, fraction] = text.split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export interface RateLine {
  /** "1,000 VND" */
  amount: string;
  /** "0.12 ₪" */
  ils: string;
  /** "0.04 $"; null for USD itself. */
  usd: string | null;
}

/** The parts of the card's line; null for ILS (no line at all). */
export function rateLine(rate: Rate): RateLine | null {
  if (rate.currency === 'ILS') return null;
  const unit = unitFor(rate.rateToIls);
  return {
    amount: `${groupThousands(String(unit))} ${rate.currency}`,
    ils: `${twoSignificant(unit * rate.rateToIls)} ₪`,
    usd: rate.currency === 'USD' ? null : `${twoSignificant(unit * rate.rateToUsd)} $`,
  };
}

/** True when the saved rate is over 3 days old by the device clock (AC-4). */
export function isStale(fetchedAt: string, now = Date.now()): boolean {
  return now - Date.parse(fetchedAt) > 3 * 24 * 60 * 60 * 1000;
}

/**
 * The calculator (AC-2): a typed amount, with a point or a comma, up to 12
 * digits before it and 2 after. Anything else is refused (null).
 */
export function parseAmount(text: string): number | null {
  const normal = text.trim().replace(',', '.');
  if (!/^\d{1,12}(\.\d{0,2})?$/.test(normal)) return null;
  return Number(normal);
}

/** A converted amount for the calculator: 2 decimals, thousands separated. */
export function formatAmount(value: number): string {
  return groupThousands(value.toFixed(2));
}
