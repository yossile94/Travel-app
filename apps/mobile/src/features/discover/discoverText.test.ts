// Sprint 9 design 16: every wording of discovery search, in both languages.
import i18n from '@/i18n';

import { NO_FILTERS, type DiscoverResult } from './discover';
import {
  advisoriesAsOf,
  citiesLine,
  countText,
  failureText,
  formatFlightHours,
  numericDate,
  reasonTexts,
} from './discoverText';

const he = i18n.getFixedT('he');
const en = i18n.getFixedT('en');
const LRI = String.fromCodePoint(0x2066);
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);
const MINUS = String.fromCodePoint(0x2212);
const strip = (s: string) => s.replace(/[⁦-⁩]/g, '');

const result = (over: Partial<DiscoverResult>): DiscoverResult => ({
  adm0: 'GRC',
  km: 1200,
  match: true,
  reasons: { hours: 2 },
  cities: [],
  ...over,
});

describe('flight hours (design 16.4)', () => {
  it.each([
    [0.5, 'כחצי שעה', 'about 30 min'],
    [1, 'כשעה', 'about 1 hour'],
    [1.5, 'כשעה וחצי', 'about 1.5 hours'],
    [2, 'כשעתיים', 'about 2 hours'],
    [2.5, 'כשעתיים וחצי', 'about 2.5 hours'],
    [4, 'כ-4 שעות', 'about 4 hours'],
    [9.5, 'כ-9 שעות וחצי', 'about 9.5 hours'],
  ])('%s hours', (h, hebrew, english) => {
    expect(formatFlightHours(h, he)).toBe(hebrew);
    expect(formatFlightHours(h, en)).toBe(english);
  });
});

describe('reasons (design 8.4)', () => {
  it('family: level, entry, then the month temperature, in order', () => {
    const r = result({ reasons: { hours: 2, nsc: 1, entry: 'allowed', temp: 15 } });
    expect(reasonTexts(r, { month: 11 }, he, 'he').map((x) => strip(x.text))).toEqual([
      'אזהרה רמה 1',
      'כניסה מותרת',
      '15° בדצמבר',
    ]);
  });

  it('entry not filled in yet: "check entry before you travel"', () => {
    const r = result({ reasons: { hours: 2, nsc: 2, entry: 'check' } });
    expect(reasonTexts(r, NO_FILTERS, en, 'en')[1]?.text).toBe('Check entry before you travel');
  });

  it('a city temperature names the city; the label reads the degrees in words', () => {
    const r = result({
      reasons: { hours: 12, temp: -3, tempCity: { nameHe: '', nameEn: 'Oulu' }, rain: 0 },
    });
    const [temp, rain] = reasonTexts(r, { month: 0 }, he, 'he');
    expect(temp!.text).toBe(`${FSI}Oulu${PDI} ${LRI}${MINUS}3°${PDI} בינואר`);
    expect(temp!.a11y).toBe(`${FSI}Oulu${PDI} מינוס 3 מעלות בינואר`);
    expect(rain!.text).toBe('בלי ימי גשם');
  });

  it('hot: rain days and the coast', () => {
    const r = result({ reasons: { hours: 9, temp: 27, rain: 1, coast: true } });
    expect(reasonTexts(r, { month: 11 }, en, 'en').map((x) => strip(x.text))).toEqual([
      '27° in December',
      '1 rainy day',
      'Coastline',
    ]);
  });
});

describe('the rest of the panel', () => {
  it('counts', () => {
    expect(countText(0, he)).toBe('אין מדינות שמתאימות לכל התנאים');
    expect(countText(1, he)).toBe('מדינה אחת מתאימה');
    expect(countText(14, en)).toBe('14 countries match');
  });

  it('cities, with "and N more"', () => {
    const cities = [
      { id: 1, nameHe: 'מיאמי', nameEn: 'Miami' },
      { id: 2, nameHe: '', nameEn: 'Honolulu' },
    ];
    expect(citiesLine(cities, he, 'he')).toBe(`ערים: מיאמי, ${FSI}Honolulu${PDI}`);
    expect(citiesLine(cities, en, 'en', 2)).toBe(
      'Cities: Miami, Honolulu and 2 more'.replace(
        'Miami, Honolulu',
        `${FSI}Miami${PDI}, ${FSI}Honolulu${PDI}`,
      ),
    );
    expect(citiesLine([], he, 'he')).toBeNull();
  });

  it('the first failing rule, in words (design 16.6)', () => {
    const f = { month: 6 };
    expect(
      failureText(
        result({ match: false, failure: 'tooHot', reasons: { hours: 3, temp: 33 } }),
        f,
        he,
      ),
    ).toBe(`${LRI}33°${PDI} ביולי, חם מדי לחיפוש הזה`);
    expect(
      failureText(
        result({ match: false, failure: 'nscHigh', reasons: { hours: 3, nsc: 4 } }),
        f,
        en,
      ),
    ).toBe('Level 4 advisory in part of the country');
    expect(
      failureText(result({ match: false, failure: 'far', reasons: { hours: 9 } }), f, he),
    ).toBe('כ-9 שעות טיסה');
    expect(failureText(result({}), f, he)).toBeNull();
  });

  it('the advisories date is the newest fetchedAt', () => {
    expect(
      advisoriesAsOf([
        { fetchedAt: '2026-10-01T03:00:00Z' },
        { fetchedAt: null },
        { fetchedAt: '2026-10-12T03:00:00Z' },
      ]),
    ).toBe('2026-10-12T03:00:00Z');
    expect(advisoriesAsOf(null)).toBeNull();
    expect(numericDate('2026-10-12T09:00:00Z')).toBe(`${LRI}12.10.2026${PDI}`);
  });
});
