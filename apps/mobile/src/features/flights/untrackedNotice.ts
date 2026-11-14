/**
 * Sprint 15 AC-6 (design 6.1, 6.4): what the toast says when a flight was
 * saved without tracking, past a cap. The renewal date is the device's own
 * day, read left to right; the screen reader hears the spoken date.
 */
import type { TFunction } from 'i18next';

import { isolateLtr } from '@/features/globe/BoardingPassCard';
import { formatDate } from '@/features/trips/tripDates';

import type { Untracked } from './flightsApi';
import { dayMonth } from './flightTime';

type T = TFunction | ((key: string, options?: Record<string, unknown>) => string);

/** "2027-01-14" in the device's time zone. */
function localDay(at: string): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function untrackedNotice(
  result: Untracked,
  t: T,
  now: Date = new Date(),
): { text: string; a11y: string } {
  if (result.untracked !== 'turnover' || !result.renewsAt) {
    // Turnover without a date only with a limit of 0 (no tier has one): the
    // dateless "reached the number" text says the same without a wrong date.
    const key =
      result.untracked === 'turnover'
        ? 'flight.untracked.concurrent'
        : `flight.untracked.${result.untracked}`;
    const text = t(key);
    return { text, a11y: text };
  }
  const day = localDay(result.renewsAt);
  const year = Number(day.slice(0, 4));
  // Another year: with the year (design 6.4).
  const shown = year === now.getFullYear() ? dayMonth(day) : `${dayMonth(day)}.${year}`;
  return {
    text: t('flight.untracked.turnover', { date: isolateLtr(shown) }),
    a11y: t('flight.untracked.turnover', { date: formatDate(day, t as TFunction) }),
  };
}
