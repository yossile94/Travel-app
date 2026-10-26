/**
 * Native Google sign-in (sprint 1 AC-15, AC-20): Google returns an ID token
 * for our Web client, and Supabase exchanges it for a session. Every way it
 * can end is a named result, so the sheet can show the right message.
 */
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export const hasGoogleConfig = Boolean(webClientId);

let configured = false;
function configure() {
  if (configured || !webClientId) return;
  // Only the ID token is needed: no Google APIs are called, so no extra scopes.
  GoogleSignin.configure({ webClientId });
  configured = true;
}

export type GoogleResult =
  | { kind: 'token'; idToken: string }
  | { kind: 'cancelled' }
  /**
   * Missing or too old: the library reports both the same way. An old
   * install has already been offered the system update dialog by then.
   */
  | { kind: 'playServicesUnavailable' }
  | { kind: 'network' }
  | { kind: 'error'; error: unknown };

/** Google's network error code (CommonStatusCodes.NETWORK_ERROR). */
const NETWORK_ERROR = '7';

export async function googleIdToken(): Promise<GoogleResult> {
  configure();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return { kind: 'playServicesUnavailable' };
    }
    return { kind: 'error', error };
  }

  try {
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { kind: 'cancelled' };
    const { idToken } = response.data;
    return idToken
      ? { kind: 'token', idToken }
      : { kind: 'error', error: new Error('no ID token') };
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) return { kind: 'cancelled' };
      if (error.code === NETWORK_ERROR) return { kind: 'network' };
    }
    return { kind: 'error', error };
  }
}

/** Forgets the Google account choice, so the next sign-in asks again. Best effort. */
export async function googleSignOut(): Promise<void> {
  try {
    configure();
    await GoogleSignin.signOut();
  } catch {
    // Signing out of Supabase is what matters; Google's state is a convenience.
  }
}

/**
 * Revokes the app's access to the Google account (sprint 2 AC-16). Best
 * effort and bounded: a failure or a slow answer never holds up the wipe.
 */
export async function googleRevoke(timeoutMs = 5000): Promise<void> {
  try {
    configure();
    await Promise.race([
      GoogleSignin.revokeAccess(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Signed out locally regardless; the access lapses with the deleted account.
  }
  await googleSignOut();
}

async function revokeThenChoose(): Promise<GoogleResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    configure();
    await Promise.race([
      GoogleSignin.revokeAccess(),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
  } catch {
    // Nothing to revoke (never signed in with Google on this device): fine.
  } finally {
    clearTimeout(timer);
  }
  await googleSignOut();
  return googleIdToken();
}

/**
 * A Google ID token for account deletion (sprint 2 AC-18), after an explicit
 * choice of the account: access is revoked first, so the picker always shows.
 * Play services may still hand back its cached token (up to an hour old; it
 * can't be forced without a nonce, which this library doesn't offer), so the
 * server accepts an unexpired token of the same Google identity, up to 60
 * minutes old (ADR-006 6; Yossi, 2026-10-26, sprint 3 QA B-1). One picker.
 */
export async function googleFreshIdToken(): Promise<GoogleResult> {
  return revokeThenChoose();
}
