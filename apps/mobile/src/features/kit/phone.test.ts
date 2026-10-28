import { formatPhone, normalizePhone } from './phone';

// The same cases as the server's CHECK (travel_kit.test.sql): one rule.
describe('normalizePhone', () => {
  it.each([
    ['+66 2 653-9000', '+6626539000'],
    ['0066 (2) 6539000', '+6626539000'],
    ['+972 3 929 4000', '+97239294000'],
    ['00-54-11-37244500', '+541137244500'],
    ['+1 202 364 5500', '+12023645500'],
  ])('%s → %s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each([
    ['026335000'],
    ['+0 123 456 789'],
    ['+12345'],
    ['+1234567890123456'],
    ['+66 2 abc'],
    [''],
  ])('refuses %s', (input) => expect(normalizePhone(input)).toBeNull());
});

describe('formatPhone', () => {
  it('splits the country code from the rest', () => {
    expect(formatPhone('+6626539000')).toBe('+66 26539000');
    expect(formatPhone('+97239294000')).toBe('+972 39294000');
    expect(formatPhone('+12023645500')).toBe('+1 2023645500');
  });
  it('keeps short local numbers as they are', () => {
    expect(formatPhone('191')).toBe('191');
    expect(formatPhone('1669')).toBe('1669');
  });
});
