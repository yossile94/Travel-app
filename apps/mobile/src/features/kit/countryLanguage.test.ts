import meta from '@/features/globe/countryMeta.json';

import { COUNTRY_PLACES, localLanguageFor, regionsFor } from './countryLanguage';

// The same shapes the places function accepts (supabase/functions/places).
const REGION = /^[A-Z]{2}$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Z]{2}|-[A-Z][a-z]{3})?$/;

describe('countryLanguage (sprint 14, Raz 2)', () => {
  it('covers every country on the globe, in shapes the server accepts', () => {
    const missing = Object.keys(meta).filter((adm0) => !COUNTRY_PLACES[adm0]);
    expect(missing).toEqual([]);
    for (const [adm0, { region, language }] of Object.entries(COUNTRY_PLACES)) {
      expect(`${adm0} ${region}`).toMatch(/ [A-Z]{2}$/);
      expect(region).toMatch(REGION);
      expect(language).toMatch(LANGUAGE);
    }
  });

  it('gives the driver the local language', () => {
    expect(localLanguageFor('THA')).toBe('th');
    expect(localLanguageFor('JPN')).toBe('ja');
    expect(localLanguageFor('GRC')).toBe('el');
    expect(localLanguageFor('TWN')).toBe('zh-TW');
    expect(localLanguageFor('GBR')).toBe('en');
    expect(localLanguageFor('XXX')).toBe('en');
  });

  it('limits the search to the trip countries, once each, known only', () => {
    expect(regionsFor(['THA', 'THA', 'XXX', 'KHM'])).toEqual(['TH', 'KH']);
  });
});
