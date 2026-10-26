/**
 * How a temperature is shown and read (sprint 3 AC-10, AC-11; design
 * section 2). One place for every rule, used by the card and the trip row:
 *   - rounded once, here, half away from zero (2.5 → 3, −2.5 → −3), never "−0°";
 *   - a minus sign U+2212, no "+", the degree sign right after the number;
 *   - each value wrapped in an isolate (in the translation, `temp.value`), so
 *     "−3°" keeps its sign on the left in right-to-left text;
 *   - a range from the low to the high, one value when they are equal, and a
 *     Hebrew wording that never puts "ל-" right before a minus;
 *   - a screen-reader label in words, never built from the visible string.
 * Values come in hundredths of a degree (scripts/build-climate.mjs).
 */
import type { TFunction } from 'i18next';

const MINUS = String.fromCodePoint(0x2212);

/** Whole degrees from hundredths, rounded half away from zero; never −0. */
export function roundTemp(hundredths: number): number {
  const degrees = hundredths / 100;
  const rounded = Math.sign(degrees) * Math.round(Math.abs(degrees));
  return rounded === 0 ? 0 : rounded;
}

function shown(n: number, t: TFunction): string {
  return t('temp.value', { n: n < 0 ? `${MINUS}${-n}` : String(n) });
}

function inWords(n: number, t: TFunction): string {
  if (n === 1) return t('temp.a11y.one');
  if (n === -1) return t('temp.a11y.minusOne');
  return n < 0 ? t('temp.a11y.minusMany', { n: -n }) : t('temp.a11y.many', { n });
}

/** One value, from hundredths: "28°", "−3°" (isolated). */
export function formatTemp(hundredths: number, t: TFunction): string {
  return shown(roundTemp(hundredths), t);
}

/** The words for one value: "מינוס 3 מעלות". */
export function tempA11y(hundredths: number, t: TFunction): string {
  return inWords(roundTemp(hundredths), t);
}

/**
 * The range of several months (4 or more, AC-11): each month rounded, then
 * the low and the high, so the range agrees with the months.
 */
export function formatTempRange(values: number[], t: TFunction): string {
  const rounded = values.map(roundTemp);
  const low = Math.min(...rounded);
  const high = Math.max(...rounded);
  if (low === high) return shown(low, t);
  return t(high < 0 ? 'climate.rangeNegHigh' : 'climate.range', {
    low: shown(low, t),
    high: shown(high, t),
  });
}

/** The words for a range: always "בין X ובין Y". */
export function tempRangeA11y(values: number[], t: TFunction): string {
  const rounded = values.map(roundTemp);
  const low = Math.min(...rounded);
  const high = Math.max(...rounded);
  if (low === high) return inWords(low, t);
  return t('climate.rangeA11y', { low: inWords(low, t), high: inWords(high, t) });
}

/**
 * The calendar months (0-11) a trip touches, in order (AC-11): 20 Dec to
 * 5 Jan is [11, 0]. Dates are "YYYY-MM-DD"; at most the first 12.
 */
export function tripMonths(startDate: string, endDate: string): number[] {
  const [y1, m1] = startDate.split('-').map(Number) as [number, number];
  const [y2, m2] = endDate.split('-').map(Number) as [number, number];
  const count = Math.min(12, (y2 - y1) * 12 + (m2 - m1) + 1);
  return Array.from({ length: Math.max(1, count) }, (_, i) => (m1 - 1 + i) % 12);
}
