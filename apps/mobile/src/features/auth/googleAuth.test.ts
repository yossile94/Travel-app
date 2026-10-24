// The module reads the client ID when it loads, so it is set first and both
// modules are loaded after it (imports would be hoisted above this line).
process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
/* eslint-disable @typescript-eslint/no-require-imports */
const { GoogleSignin, statusCodes } =
  require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
const { googleIdToken } = require('./googleAuth') as typeof import('./googleAuth');
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
