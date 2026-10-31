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
    // Hebrew alone has a plural form for 2 ("_two").
    expect(keys(en).sort()).toEqual(
      keys(he)
        .filter((k) => !k.endsWith('_two'))
        .sort(),
    );
  });

  it('every Hebrew plural has its form for 2, or 2 falls back to English (Raz, sprint 13)', () => {
    const all = keys(he);
    const missing = all
      .filter((k) => k.endsWith('_other'))
      .map((k) => k.replace(/_other$/, '_two'))
      .filter((k) => !all.includes(k));
    expect(missing).toEqual([]);
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
