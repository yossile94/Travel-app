/**
 * Dates of a trip (sprint 2 design 4.1, 4.3). A trip date is a calendar day,
 * stored as Postgres `date` ("YYYY-MM-DD"). It always goes through local
 * date parts, never toISOString() or new Date("YYYY-MM-DD"): both are UTC,
 * which in Israel (UTC+2/+3) turns a midnight choice into the day before.
 * Month names come from the translation files: Hermes has no Intl.
 */
import type { TFunction } from 'i18next';

/** A date picker's Date as a Postgres date, from its local parts. */
export function toPgDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** A Postgres date as local midnight of that day. */
export function fromPgDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Today on this device, as a Postgres date (design 17.4). */
export function todayPg(now: Date = new Date()): string {
  return toPgDate(now);
}

/** "Upcoming" holds trips not over yet (active or future); "past" those that ended (AC-5). */
export function isPast(endDate: string, today: string): boolean {
  return endDate < today;
}

/** Departure on or before today and return on or after it (AC-5). */
export function isActive(startDate: string, endDate: string, today: string): boolean {
  return startDate <= today && endDate >= today;
}

function parts(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

/** One date: "12 באוגוסט 2027" / "12 Aug 2027". */
export function formatDate(value: string, t: TFunction): string {
  const { y, m, d } = parts(value);
  return t('date.single', { d, y, month: t(`months.${m}`), monthShort: t(`monthsShort.${m}`) });
}

/**
 * A trip's dates as a range, with an en dash (U+2013, design 4.3): it reads
 * in the right order inside Hebrew text without an isolate.
 */
export function formatRange(start: string, end: string, t: TFunction): string {
  if (start === end) return formatDate(start, t);
  const a = parts(start);
  const b = parts(end);
  if (a.y === b.y && a.m === b.m) {
    return t('date.rangeSameMonth', {
      d1: a.d,
      d2: b.d,
      y: a.y,
      month: t(`months.${a.m}`),
      monthShort: t(`monthsShort.${a.m}`),
    });
  }
  const names = {
    month1: t(`months.${a.m}`),
    month2: t(`months.${b.m}`),
    m1: t(`monthsShort.${a.m}`),
    m2: t(`monthsShort.${b.m}`),
  };
  if (a.y === b.y) {
    return t('date.rangeSameYear', { d1: a.d, d2: b.d, y: a.y, ...names });
  }
  return t('date.rangeFull', { d1: a.d, d2: b.d, y1: a.y, y2: b.y, ...names });
}

/** The range for a screen reader: "from … to …", never a dash it would read as "minus". */
export function formatRangeA11y(start: string, end: string, t: TFunction): string {
  if (start === end) return formatDate(start, t);
  return t('date.rangeA11y', { from: formatDate(start, t), to: formatDate(end, t) });
}

/** "תאילנד אוגוסט 2027" from the country and the departure date (AC-2). */
export function defaultTripName(country: string, startDate: string, t: TFunction): string {
  const { y, m } = parts(startDate);
  return t('tripForm.defaultName', { country, month: t(`months.${m}`), year: y });
}

/** Length as Postgres counts it (char_length): code points, not UTF-16 units. */
export function codePointLength(text: string): number {
  return [...text].length;
}
