import i18n from '@/i18n';

import {
  formatTemp,
  formatTempRange,
  roundTemp,
  tempA11y,
  tempRangeA11y,
  tripMonths,
} from './tempFormat';

const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const MINUS = String.fromCodePoint(0x2212);
const iso = (s: string) => `${LRI}${s}${PDI}`;

describe('temperature rules (sprint 3 design section 2)', () => {
  const he = i18n.getFixedT('he');
  const en = i18n.getFixedT('en');

  it('rounds once, half away from zero, never to −0', () => {
    expect(roundTemp(250)).toBe(3);
    expect(roundTemp(-250)).toBe(-3);
    expect(roundTemp(2549)).toBe(25);
    expect(Object.is(roundTemp(-40), 0)).toBe(true);
  });

  it('shows a minus sign U+2212 inside an isolate, and no plus', () => {
    expect(formatTemp(-300, he)).toBe(iso(`${MINUS}3°`));
    expect(formatTemp(-250, en)).toBe(iso(`${MINUS}3°`));
    expect(formatTemp(2800, he)).toBe(iso('28°'));
    expect(formatTemp(-40, he)).toBe(iso('0°'));
  });

  it('words a range so "ל-" never sits before a minus', () => {
    expect(formatTempRange([-300, 700], he)).toBe(`בין ${iso(`${MINUS}3°`)} ל-${iso('7°')}`);
    expect(formatTempRange([-1200, -300], he)).toBe(
      `בין ${iso(`${MINUS}12°`)} ובין ${iso(`${MINUS}3°`)}`,
    );
    expect(formatTempRange([-300, 700], en)).toBe(`Between ${iso(`${MINUS}3°`)} and ${iso('7°')}`);
    // Equal after rounding: one value (Singapore).
    expect(formatTempRange([2790, 2810, 2770], he)).toBe(iso('28°'));
  });

  it('a range agrees with its months: each month rounded first', () => {
    expect(formatTempRange([250, 749], en)).toBe(`Between ${iso('3°')} and ${iso('7°')}`);
  });

  it('reads values in words for the screen reader', () => {
    expect(tempA11y(100, he)).toBe('מעלה אחת');
    expect(tempA11y(-100, he)).toBe('מינוס מעלה אחת');
    expect(tempA11y(-300, he)).toBe('מינוס 3 מעלות');
    expect(tempA11y(0, he)).toBe('0 מעלות');
    expect(tempA11y(-300, en)).toBe('minus 3 degrees');
    expect(tempRangeA11y([-300, 700], he)).toBe('בין מינוס 3 מעלות ובין 7 מעלות');
  });

  it('lists the calendar months a trip touches (AC-11)', () => {
    expect(tripMonths('2026-12-20', '2027-01-05')).toEqual([11, 0]);
    expect(tripMonths('2026-10-26', '2026-10-26')).toEqual([9]);
    expect(tripMonths('2026-01-10', '2026-05-02')).toEqual([0, 1, 2, 3, 4]);
    expect(tripMonths('2026-01-01', '2028-01-01')).toHaveLength(12);
  });
});
