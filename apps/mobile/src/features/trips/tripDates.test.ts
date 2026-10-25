import i18n from '@/i18n';

import {
  codePointLength,
  defaultTripName,
  formatDate,
  formatRange,
  formatRangeA11y,
  fromPgDate,
  isActive,
  isPast,
  toPgDate,
} from './tripDates';

const t = i18n.t.bind(i18n);

describe('trip dates (sprint 2 design 4.1, 4.3)', () => {
  it('converts a picked date from its local parts, never through UTC', () => {
    // Local midnight in Israel is 21:00 or 22:00 UTC the day before.
    const midnight = new Date(2027, 7, 12, 0, 0, 0);
    expect(toPgDate(midnight)).toBe('2027-08-12');
    expect(toPgDate(new Date(2027, 7, 12, 23, 59))).toBe('2027-08-12');
    // A daylight-saving change day (Israel: last Friday before April 2nd).
    expect(toPgDate(new Date(2027, 2, 26, 0, 0))).toBe('2027-03-26');
  });

  it('reads a Postgres date as local midnight of that day', () => {
    const date = fromPgDate('2027-08-12');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([
      2027, 7, 12, 0,
    ]);
    expect(toPgDate(fromPgDate('2026-12-31'))).toBe('2026-12-31');
  });

  it('splits upcoming and past by the local date, with an active trip upcoming', () => {
    const today = '2026-10-26';
    expect(isPast('2026-10-25', today)).toBe(true);
    expect(isPast('2026-10-26', today)).toBe(false);
    expect(isActive('2026-10-20', '2026-10-26', today)).toBe(true);
    expect(isActive('2026-10-27', '2026-10-30', today)).toBe(false);
  });

  it('formats dates and ranges in Hebrew, with an en dash', () => {
    expect(formatDate('2027-08-12', t)).toBe('12 באוגוסט 2027');
    expect(formatRange('2027-08-12', '2027-08-20', t)).toBe('12–20 באוגוסט 2027');
    expect(formatRange('2027-07-28', '2027-08-04', t)).toBe('28 ביולי – 4 באוגוסט 2027');
    expect(formatRange('2026-12-20', '2027-01-05', t)).toBe('20 בדצמבר 2026 – 5 בינואר 2027');
    expect(formatRange('2027-08-12', '2027-08-12', t)).toBe('12 באוגוסט 2027');
    expect(formatRange('2027-08-12', '2027-08-20', t)).toContain('–');
    expect(formatRange('2027-08-12', '2027-08-20', t)).not.toContain('-');
  });

  it('formats in English too', async () => {
    const en = i18n.cloneInstance({ lng: 'en' });
    const tEn = en.t.bind(en);
    expect(formatRange('2027-08-12', '2027-08-20', tEn)).toBe('12–20 Aug 2027');
    expect(formatRange('2026-12-20', '2027-01-05', tEn)).toBe('20 Dec 2026 – 5 Jan 2027');
    expect(defaultTripName('Thailand', '2027-08-12', tEn)).toBe('Thailand August 2027');
  });

  it('reads a range to a screen reader with words, not a dash', () => {
    expect(formatRangeA11y('2026-12-20', '2027-01-05', t)).toBe('20 בדצמבר 2026 עד 5 בינואר 2027');
  });

  it('names a trip from the country and the departure month (AC-2)', () => {
    expect(defaultTripName('תאילנד', '2027-08-12', t)).toBe('תאילנד אוגוסט 2027');
  });

  it('counts characters as Postgres does (code points)', () => {
    expect(codePointLength('תאילנד')).toBe(6);
    expect(codePointLength('🏝️ חופשה')).toBe(8);
    expect('🏝'.length).toBe(2);
    expect(codePointLength('🏝')).toBe(1);
  });
});
