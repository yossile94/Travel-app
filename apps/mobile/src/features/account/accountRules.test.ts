import { cleanDisplayName, displayNameError } from './accountApi';
import { answerFrom } from './deleteAccountApi';

jest.mock('@/lib/supabase', () => ({ supabase: null }));

describe('display name (sprint 2 AC-12, design 8.2)', () => {
  it('cleans a Google name the way the database accepts it', () => {
    expect(cleanDisplayName('  דנה   כהן ')).toBe('דנה כהן');
    expect(cleanDisplayName('   ')).toBeNull();
    expect(cleanDisplayName(null)).toBeNull();
    expect([...cleanDisplayName('🏝'.repeat(70))!].length).toBe(60);
  });

  it('checks 1–60 code points after trim', () => {
    expect(displayNameError('  ')).toBe('nameEdit.required');
    expect(displayNameError('a'.repeat(61))).toBe('nameEdit.tooLong');
    expect(displayNameError(` ${'🏝'.repeat(60)} `)).toBeNull();
  });
});

describe('delete-account answers (ADR-006 section 6)', () => {
  it('only a 200 with "deleted" counts as deleted', () => {
    expect(answerFrom(200, { deleted: true })).toBe('deleted');
    expect(answerFrom(200, { deleted: false })).toBe('deleted');
    expect(answerFrom(200, {})).toBe('error');
    expect(answerFrom(200, null)).toBe('error');
  });

  it('maps every refusal, and anything outside the contract to an error', () => {
    expect(answerFrom(401, { error: 'unauthorized' })).toBe('unauthorized');
    expect(answerFrom(403, { error: 'wrong_account' })).toBe('wrongAccount');
    expect(answerFrom(403, { error: 'reauth_failed' })).toBe('reauthFailed');
    expect(answerFrom(403, { error: 'something_else' })).toBe('error');
    expect(answerFrom(503, { error: 'unavailable' })).toBe('unavailable');
    expect(answerFrom(500, null)).toBe('error');
    expect(answerFrom(413, null)).toBe('error');
    expect(answerFrom(502, '<html>')).toBe('error');
  });
});
