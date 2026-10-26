import {
  formatAmount,
  isStale,
  parseAmount,
  rateLine,
  rateLineText,
  twoSignificant,
  unitFor,
  type Rate,
} from './rateFormat';

const rate = (currency: string, rateToIls: number, rateToUsd: number): Rate => ({
  currency,
  rateToIls,
  rateToUsd,
  source: 'erapi',
  rateDate: '2026-10-26',
  fetchedAt: '2026-10-26T14:15:00Z',
});

describe('the rate line (sprint 4 AC-1)', () => {
  it('picks the smallest amount worth at least 0.1 shekels', () => {
    expect(unitFor(3.4462)).toBe(1); // EUR
    expect(unitFor(0.095)).toBe(10); // THB
    expect(unitFor(0.0196)).toBe(10); // JPY
    expect(unitFor(0.000123)).toBe(1000); // VND
    expect(unitFor(0.000188)).toBe(1000); // IDR
    expect(unitFor(0.00000001)).toBe(10000);
  });

  it('rounds to two significant digits', () => {
    expect(twoSignificant(3.4462)).toBe('3.4');
    expect(twoSignificant(0.951)).toBe('0.95');
    expect(twoSignificant(0.123)).toBe('0.12');
    expect(twoSignificant(0.0995)).toBe('0.10');
    expect(twoSignificant(1234)).toBe('1,200');
  });

  it('builds the line for EUR, THB, JPY, VND and IDR', () => {
    expect(rateLine(rate('EUR', 3.4462, 1.1197))).toEqual({
      amount: '1 EUR',
      ils: '3.4 ₪',
      usd: '1.1 $',
    });
    expect(rateLine(rate('THB', 0.095, 0.0309))).toEqual({
      amount: '10 THB',
      ils: '0.95 ₪',
      usd: '0.31 $',
    });
    expect(rateLine(rate('JPY', 0.019557, 0.006354))).toEqual({
      amount: '10 JPY',
      ils: '0.20 ₪',
      usd: '0.064 $',
    });
    expect(rateLine(rate('VND', 0.000123, 0.00004))).toEqual({
      amount: '1,000 VND',
      ils: '0.12 ₪',
      usd: '0.040 $',
    });
    expect(rateLine(rate('IDR', 0.000188, 0.0000611))?.amount).toBe('1,000 IDR');
  });

  it('no line for ILS; USD shows only the shekels', () => {
    expect(rateLine(rate('ILS', 1, 0.32))).toBeNull();
    expect(rateLine(rate('USD', 3.078, 1))).toEqual({ amount: '1 USD', ils: '3.1 ₪', usd: null });
  });

  it('a saved rate over 3 days old may be out of date (AC-4)', () => {
    const fetched = '2026-10-26T14:15:00Z';
    expect(isStale(fetched, Date.parse('2026-10-29T14:00:00Z'))).toBe(false);
    expect(isStale(fetched, Date.parse('2026-10-29T15:00:00Z'))).toBe(true);
  });
});

describe('the calculator input (sprint 4 AC-2)', () => {
  it('takes a point or a comma, up to 12 digits and 2 decimals', () => {
    expect(parseAmount('100')).toBe(100);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount(' 3.75 ')).toBe(3.75);
    expect(parseAmount('123456789012')).toBe(123456789012);
    expect(parseAmount('1234567890123')).toBeNull();
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('1e5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('shows results with 2 decimals', () => {
    // No separators: the field stays editable (Raz, design change 6).
    expect(formatAmount(1234.5)).toBe('1234.50');
    expect(formatAmount(1e12)).toBeNull();
    expect(parseAmount('.5')).toBe(0.5);
  });
});

describe('the design table (sprint 4 design 3.4, USD/ILS 3.2)', () => {
  const usdIls = 3.2;
  const line = (code: string, toIls: number) => rateLine({ ...rate(code, toIls, toIls / usdIls) });
  it.each([
    ['EUR', 3.72, '1 EUR', '3.7 ₪', '1.2 $'],
    ['THB', 0.11, '1 THB', '0.11 ₪', '0.034 $'],
    ['THB', 0.0952, '10 THB', '0.95 ₪', '0.30 $'],
    ['JPY', 0.0213, '10 JPY', '0.21 ₪', '0.067 $'],
    ['VND', 0.000122, '1,000 VND', '0.12 ₪', '0.038 $'],
    ['IDR', 0.000198, '1,000 IDR', '0.20 ₪', '0.062 $'],
    ['XXX', 0.00999, '100 XXX', '1.0 ₪', '0.31 $'],
    ['KWD', 12.3, '1 KWD', '12 ₪', '3.8 $'],
  ])('%s at %f', (code, toIls, amount, ils, usd) => {
    expect(line(code, toIls)).toEqual({ amount, ils, usd });
  });

  it('one string that wraps only before "·"', () => {
    const nbsp = String.fromCodePoint(0xa0);
    const text = rateLineText({ amount: '1,000 VND', ils: '0.12 ₪', usd: '0.038 $' });
    expect(text).toBe(`1,000${nbsp}VND${nbsp}=${nbsp}0.12${nbsp}₪ ·${nbsp}0.038${nbsp}$`);
    expect(text.split(' ')).toHaveLength(2);
  });
});
