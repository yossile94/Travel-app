import { countryByAdm0, smallCountryPoints } from './countryData';

describe('countryByAdm0', () => {
  it('returns everything the card needs', () => {
    const thailand = countryByAdm0('THA');
    expect(thailand).toMatchObject({
      adm0: 'THA',
      nameHe: 'תאילנד',
      nameEn: 'Thailand',
      timeZone: 'Asia/Bangkok',
      currency: { code: 'THB', symbol: '฿' },
    });
    expect(thailand?.label).toHaveLength(2);
  });

  it('returns nothing for areas that are not destinations', () => {
    expect(countryByAdm0('GAZ')).toBeUndefined();
    expect(countryByAdm0('nope')).toBeUndefined();
  });
});

describe('smallCountryPoints', () => {
  it('has a point for each small area, including microstates', () => {
    const adm0s = smallCountryPoints.features.map((f) => f.properties.adm0);
    expect(adm0s).toEqual(expect.arrayContaining(['VAT', 'MCO', 'SGP', 'MDV']));
    expect(adm0s).not.toContain('ISR');
  });
});
