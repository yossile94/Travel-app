import { resolveTap } from './resolveTap';

const italy = { adm0: 'ITA', code: 'IT' };
const gaza = { adm0: 'GAZ', code: null };
const malta = { adm0: 'MLT', code: 'MT' };

describe('resolveTap', () => {
  it('selects the country under the finger', () => {
    expect(resolveTap({ country: italy })).toEqual({ type: 'select', adm0: 'ITA' });
  });

  it('lets a big country win over a nearby small one on land (Rome is not the Vatican)', () => {
    expect(resolveTap({ country: italy, smallWide: 'VAT' })).toEqual({
      type: 'select',
      adm0: 'ITA',
    });
  });

  it('selects the small area when the tap lands right on its dot, even over land', () => {
    expect(resolveTap({ country: italy, smallWide: 'VAT', smallTight: 'VAT' })).toEqual({
      type: 'select',
      adm0: 'VAT',
    });
  });

  it('uses the wide target over the sea, so small islands are easy to hit (AC-5)', () => {
    expect(resolveTap({ smallWide: 'MDV' })).toEqual({ type: 'select', adm0: 'MDV' });
  });

  it('selects a small area when its own polygon is hit', () => {
    expect(resolveTap({ country: malta })).toEqual({ type: 'select', adm0: 'MLT' });
  });

  it('closes the card on open sea or space', () => {
    expect(resolveTap({})).toEqual({ type: 'ocean' });
  });

  it('does nothing on land that is not a destination (Gaza Strip)', () => {
    expect(resolveTap({ country: gaza })).toEqual({ type: 'ignore' });
    expect(resolveTap({ country: gaza, smallWide: 'XXX' })).toEqual({ type: 'ignore' });
  });
});
