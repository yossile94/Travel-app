import i18next from 'i18next';

import i18n from './index';
import en from './locales/en.json';
import he from './locales/he.json';

function keys(object: object, prefix = ''): string[] {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? keys(value as object, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('translations', () => {
  it('has the same keys in Hebrew and English', () => {
    // Hebrew alone has the forms for 2 ("_two") and, on older ICU, "_many".
    expect(keys(en).sort()).toEqual(
      keys(he)
        .filter((k) => !k.endsWith('_two') && !k.endsWith('_many'))
        .sort(),
    );
  });

  it('every Hebrew plural has its forms for 2 and "many", or they fall back to English', () => {
    // Raz (sprint 13): "two". Dana (sprint 13): Android 13 and older (CLDR 41)
    // also give Hebrew "many" for 20, 30, 40...
    const all = keys(he);
    const missing = all
      .filter((k) => k.endsWith('_other'))
      .flatMap((k) => [k.replace(/_other$/, '_two'), k.replace(/_other$/, '_many')])
      .filter((k) => !all.includes(k));
    expect(missing).toEqual([]);
  });

  it('Dana (sprint 13): where ICU says "many" (Android 13 and older), 20 days stay Hebrew', async () => {
    const Real = Intl.PluralRules;
    class OldIcu extends Real {
      select(n: number) {
        return n >= 20 && n % 10 === 0 ? 'many' : super.select(n);
      }
    }
    Intl.PluralRules = OldIcu as typeof Intl.PluralRules;
    try {
      const old = i18next.createInstance();
      await old.init({
        lng: 'he',
        fallbackLng: 'en',
        resources: { he: { translation: he }, en: { translation: en } },
      });
      expect(old.t('itinerary.summaryDays', { count: 20 })).toBe('20 ימים');
      expect(old.t('planner.previewPlan', { count: 30 })).toBe('30 ימים ריקים יתוכננו.');
    } finally {
      Intl.PluralRules = Real;
    }
  });

  it('two days in Hebrew read in Hebrew', () => {
    expect(i18n.t('itinerary.summaryDays', { count: 2, lng: 'he' })).toBe('יומיים');
    expect(i18n.t('planner.doneItems', { count: 2, lng: 'he' })).toBe('2 פעילויות');
    expect(i18n.t('itinerary.summaryDays', { count: 1, lng: 'he' })).toBe('יום אחד');
    expect(i18n.t('itinerary.summaryDays', { count: 5, lng: 'he' })).toBe('5 ימים');
  });

  it('has no empty strings', () => {
    for (const [key, value] of Object.entries({ ...flatten(he), ...flatten(en) })) {
      expect({ key, value: value.trim() }).not.toEqual({ key, value: '' });
    }
  });
});

function flatten(object: object, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object).flatMap(([key, value]) =>
      typeof value === 'object' && value !== null
        ? Object.entries(flatten(value as object, `${prefix}${key}.`))
        : [[`${prefix}${key}`, String(value)]],
    ),
  );
}
