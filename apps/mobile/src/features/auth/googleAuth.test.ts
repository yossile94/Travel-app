// The module reads the client ID when it loads, so it is set first and both
// modules are loaded after it (imports would be hoisted above this line).
process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
/* eslint-disable @typescript-eslint/no-require-imports */
const { GoogleSignin, statusCodes } =
  require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
const { googleFreshIdToken, googleIdToken, idTokenAgeSeconds } =
  require('./googleAuth') as typeof import('./googleAuth');
/* eslint-enable @typescript-eslint/no-require-imports */

const codeError = (code: string) => Object.assign(new Error(code), { code });

describe('googleIdToken (AC-15, AC-20)', () => {
  beforeEach(() => {
    jest.spyOn(GoogleSignin, 'hasPlayServices').mockResolvedValue(true);
    jest.spyOn(GoogleSignin, 'configure').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns the ID token, configured for the Web client only', async () => {
    jest
      .spyOn(GoogleSignin, 'signIn')
      .mockResolvedValue({ type: 'success', data: { idToken: 'token-1' } } as never);
    expect(await googleIdToken()).toEqual({ kind: 'token', idToken: 'token-1' });
    expect(GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: 'web-client.apps.googleusercontent.com',
    });
  });

  it.each([['the user closed Google', { type: 'cancelled', data: null }, 'cancelled']])(
    'maps %s to "%s"',
    async (_case, response, kind) => {
      jest.spyOn(GoogleSignin, 'signIn').mockResolvedValue(response as never);
      expect(await googleIdToken()).toMatchObject({ kind });
    },
  );

  it.each([
    [statusCodes.SIGN_IN_CANCELLED, 'cancelled'],
    ['7', 'network'],
    ['12500', 'error'],
  ])('maps the error code %s to "%s"', async (code, kind) => {
    jest.spyOn(GoogleSignin, 'signIn').mockRejectedValue(codeError(code));
    expect(await googleIdToken()).toMatchObject({ kind });
  });

  it('reports Play Services missing or out of date', async () => {
    jest
      .spyOn(GoogleSignin, 'hasPlayServices')
      .mockRejectedValue(codeError(statusCodes.PLAY_SERVICES_NOT_AVAILABLE));
    expect(await googleIdToken()).toEqual({ kind: 'playServicesUnavailable' });
  });

  it('treats a success without an ID token as an error', async () => {
    jest
      .spyOn(GoogleSignin, 'signIn')
      .mockResolvedValue({ type: 'success', data: { idToken: null } } as never);
    expect(await googleIdToken()).toMatchObject({ kind: 'error' });
  });
});

/** A JWT-shaped token whose payload carries this iat (no signature needed here). */
const tokenIssuedAt = (iat: number) =>
  `h.${btoa(JSON.stringify({ iat })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

describe('a fresh token for account deletion (sprint 2 AC-18, QA on the A73)', () => {
  const now = Date.UTC(2026, 9, 26, 7, 0, 0);
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
    jest.spyOn(GoogleSignin, 'hasPlayServices').mockResolvedValue(true);
    jest.spyOn(GoogleSignin, 'configure').mockImplementation(() => {});
    jest.spyOn(GoogleSignin, 'signOut').mockResolvedValue(null);
    jest.spyOn(GoogleSignin, 'revokeAccess').mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads the age of a token from its iat', () => {
    expect(idTokenAgeSeconds(tokenIssuedAt(now / 1000 - 90), now)).toBe(90);
    expect(idTokenAgeSeconds('not-a-jwt', now)).toBeNull();
  });

  it('revokes first, so Google issues a new token', async () => {
    jest
      .spyOn(GoogleSignin, 'signIn')
      .mockResolvedValue({
        type: 'success',
        data: { idToken: tokenIssuedAt(now / 1000 - 5) },
      } as never);
    const result = await googleFreshIdToken();
    expect(result.kind).toBe('token');
    expect(jest.mocked(GoogleSignin.revokeAccess).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(GoogleSignin.signIn).mock.invocationCallOrder[0]!,
    );
  });

  it('refuses a cached token older than 4 minutes, so nothing is sent', async () => {
    jest
      .spyOn(GoogleSignin, 'signIn')
      .mockResolvedValue({
        type: 'success',
        data: { idToken: tokenIssuedAt(now / 1000 - 40 * 60) },
      } as never);
    expect(await googleFreshIdToken()).toEqual({ kind: 'stale' });
  });

  it('goes on when there is nothing to revoke', async () => {
    jest.mocked(GoogleSignin.revokeAccess).mockRejectedValue(new Error('SIGN_IN_REQUIRED'));
    jest
      .spyOn(GoogleSignin, 'signIn')
      .mockResolvedValue({
        type: 'success',
        data: { idToken: tokenIssuedAt(now / 1000) },
      } as never);
    expect((await googleFreshIdToken()).kind).toBe('token');
  });
});
