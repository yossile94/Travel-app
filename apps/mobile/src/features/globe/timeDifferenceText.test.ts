import i18n from '@/i18n';

import { timeDifferenceText } from './timeDifferenceText';

const t = i18n.getFixedT('he');

describe('timeDifferenceText', () => {
  it.each([
    [{ kind: 'same' } as const, 'כמו שעון ישראל'],
    [{ kind: 'ahead', hours: 1, minutes: 0 } as const, 'שעה לפני ישראל'],
    [{ kind: 'behind', hours: 2, minutes: 0 } as const, 'שעתיים אחרי ישראל'],
    [{ kind: 'ahead', hours: 4, minutes: 0 } as const, '4 שעות לפני ישראל'],
    [{ kind: 'behind', hours: 7, minutes: 0 } as const, '7 שעות אחרי ישראל'],
    [{ kind: 'ahead', hours: 2, minutes: 30 } as const, '2:30 שעות לפני ישראל'],
    [{ kind: 'ahead', hours: 2, minutes: 45 } as const, '2:45 שעות לפני ישראל'],
  ])('%o → %s', (difference, expected) => {
    expect(timeDifferenceText(t, difference)).toBe(expected);
  });

  it('has English wording too', () => {
    expect(timeDifferenceText(i18n.getFixedT('en'), { kind: 'behind', hours: 7, minutes: 0 })).toBe(
      '7 hours behind Israel',
    );
  });
});
