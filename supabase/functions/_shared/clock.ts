/**
 * Times and dates in an alert (sprint 6 design 3.2, sprint 7 design 8): an
 * airport's clock, 24-hour, and the short date when the day changes.
 */

/** "01:10" at a time zone, 24-hour. */
export function clockAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** The local date "YYYY-MM-DD" at a time zone. */
export function dateAt(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "21.12" in Hebrew, "21 Dec" in English (design 3.2). */
export function shortDate(date: string, locale: 'he' | 'en'): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return locale === 'he' ? `${d}.${m}` : `${d} ${MONTHS[m - 1]}`;
}

/** Right-to-left mark: a Hebrew line that starts with "LY81" still reads right to left (design 3.1). */
export const RLM = String.fromCharCode(0x200f);
