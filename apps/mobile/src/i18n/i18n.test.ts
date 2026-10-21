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
    expect(keys(en).sort()).toEqual(keys(he).sort());
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
