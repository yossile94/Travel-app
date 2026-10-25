import { initialOf } from './AccountButton';

const user = (name: string | null, email: string | null = null) => ({ id: 'u1', name, email });

describe('initialOf (account button, sprint 1 QA)', () => {
  it('uses the first letters of the first and last words', () => {
    expect(initialOf(user('יוסי לוי'))).toBe('יל');
    expect(initialOf(user('Dana Ruth Cohen'))).toBe('DC');
  });

  it('uses the first two letters of a one-word name (one "י" reads as an apostrophe)', () => {
    expect(initialOf(user('יוסי'))).toBe('יו');
    expect(initialOf(user('  dana  '))).toBe('Da');
    expect(initialOf(user('X'))).toBe('X');
  });

  it("falls back to the email's first letter, then to nothing", () => {
    expect(initialOf(user(null, 'yossi@example.test'))).toBe('Y');
    expect(initialOf(user('   ', ''))).toBeNull();
  });

  it('never splits a character made of two UTF-16 units', () => {
    expect(initialOf(user('𝒜lex Smith'))).toBe('𝒜S');
  });
});
