/**
 * Design 9.2: "יום 3 · ג׳ 22.12" — the weekday short in the app's language
 * and the date as D.M, isolated left to right.
 */
import type { TFunction } from 'i18next';

export function weekdayShort(date: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language === 'he' ? 'he-IL' : 'en-GB', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return '';
  }
}

export const dayMonthText = (date: string) =>
  `⁦${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}⁩`;

export const dayHeading = (t: TFunction, language: string, n: number, date: string) =>
  t('itinerary.day', { n, weekday: weekdayShort(date, language), date: dayMonthText(date) });
