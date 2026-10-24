import i18n from '@/i18n';

import { timeDifferenceText } from './timeDifferenceText';

const t = i18n.getFixedT('he');

describe('timeDifferenceText (sprint 1 AC-12, design 6.7)', () => {
  it.each([
    [{ kind: 'same' } as const, 'כמו בישראל'],
    [{ kind: 'ahead', hours: 1, minutes: 0 } as const, 'שעה יותר מבישראל'],
    [{ kind: 'behind', hours: 1, minutes: 0 } as const, 'שעה פחות מבישראל'],
    [{ kind: 'behind', hours: 2, minutes: 0 } as const, 'שעתיים פחות מבישראל'],
    [{ kind: 'behind', hours: 6, minutes: 0 } as const, '6 שעות פחות מבישראל'],
    [{ kind: 'ahead', hours: 0, minutes: 30 } as const, 'חצי שעה יותר מבישראל'],
    [{ kind: 'ahead', hours: 1, minutes: 30 } as const, 'שעה וחצי יותר מבישראל'],
    [{ kind: 'ahead', hours: 2, minutes: 30 } as const, 'שעתיים וחצי יותר מבישראל'],
    [{ kind: 'behind', hours: 9, minutes: 30 } as const, '9 שעות וחצי פחות מבישראל'],
    [{ kind: 'ahead', hours: 0, minutes: 45 } as const, '45 דקות יותר מבישראל'],
    [{ kind: 'ahead', hours: 1, minutes: 45 } as const, 'שעה ו-45 דקות יותר מבישראל'],
    [{ kind: 'ahead', hours: 2, minutes: 45 } as const, 'שעתיים ו-45 דקות יותר מבישראל'],
    [{ kind: 'ahead', hours: 8, minutes: 45 } as const, '8 שעות ו-45 דקות יותר מבישראל'],
  ])('%o → %s', (difference, expected) => {
    expect(timeDifferenceText(t, difference)).toBe(expected);
  });

  it('has English wording too', () => {
    const en = i18n.getFixedT('en');
    expect(timeDifferenceText(en, { kind: 'behind', hours: 7, minutes: 0 })).toBe(
      '7 hours behind Israel',
    );
    expect(timeDifferenceText(en, { kind: 'ahead', hours: 2, minutes: 45 })).toBe(
      '2 hours 45 minutes ahead of Israel',
    );
  });
});
