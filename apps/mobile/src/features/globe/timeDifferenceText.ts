import type { TFunction } from 'i18next';

import type { TimeDifference } from './localTime';

/**
 * "4 שעות פחות מבישראל", "שעתיים וחצי יותר מבישראל", "כמו בישראל" (sprint 1
 * AC-12, design 6.7). Every form is spelled out rather than built with
 * i18next plurals, which rely on Intl.PluralRules — not available in Hermes
 * on Android.
 */
export function timeDifferenceText(t: TFunction, difference: TimeDifference): string {
  if (difference.kind === 'same') return t('timeDifference.same');
  const amount = amountText(t, difference.hours, difference.minutes);
  return t(difference.kind === 'ahead' ? 'timeDifference.ahead' : 'timeDifference.behind', {
    amount,
  });
}

function amountText(t: TFunction, hours: number, minutes: number): string {
  if (!minutes) {
    if (hours === 1) return t('timeDifference.oneHour');
    if (hours === 2) return t('timeDifference.twoHours');
    return t('timeDifference.hours', { n: hours });
  }
  if (minutes === 30) {
    if (hours === 0) return t('timeDifference.halfHour');
    if (hours === 1) return t('timeDifference.oneAndHalf');
    if (hours === 2) return t('timeDifference.twoAndHalf');
    return t('timeDifference.hoursAndHalf', { n: hours });
  }
  if (hours === 0) return t('timeDifference.minutes', { m: minutes });
  if (hours === 1) return t('timeDifference.oneHourMinutes', { m: minutes });
  if (hours === 2) return t('timeDifference.twoHoursMinutes', { m: minutes });
  return t('timeDifference.hoursMinutes', { n: hours, m: minutes });
}
