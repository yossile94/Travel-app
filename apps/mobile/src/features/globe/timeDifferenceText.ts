import type { TFunction } from 'i18next';

import type { TimeDifference } from './localTime';

/**
 * "4 שעות לפני ישראל", "שעתיים אחרי ישראל", "2:30 שעות לפני ישראל".
 * Spelled out explicitly rather than with i18next plurals, which rely on
 * Intl.PluralRules — not available in Hermes on Android.
 */
export function timeDifferenceText(t: TFunction, difference: TimeDifference): string {
  if (difference.kind === 'same') return t('timeDifference.same');

  const { hours, minutes } = difference;
  let amount: string;
  if (minutes) {
    amount = t('timeDifference.hoursMinutes', { h: hours, mm: String(minutes).padStart(2, '0') });
  } else if (hours === 1) {
    amount = t('timeDifference.oneHour');
  } else if (hours === 2) {
    amount = t('timeDifference.twoHours');
  } else {
    amount = t('timeDifference.hours', { n: hours });
  }

  return t(difference.kind === 'ahead' ? 'timeDifference.ahead' : 'timeDifference.behind', {
    amount,
  });
}
