/**
 * Sign-in and consent state for the whole app (sprint 1 F-003a; design
 * docs/design/sprint-01 sections 3–5). The globe never waits for it: an
 * account is optional until personal features arrive (decision 4).
 *
 * States: loading → unavailable (not configured) | signedOut | needsConsent |
 * signedIn. A signed-in user without consent on record only ever sees the
 * consent screen, whose one exit is signing out (AC-18a).
 *
 * Every async flow captures a generation number and drops its result if a
 * sign-out happened meanwhile, so a late answer can never bring back a
 * signed-in state without a session.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { isAuthRetryableFetchError, type User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';

import { consentNeed, type ConsentNeed, type LegalDocument } from './consentStatus';
import {
  fetchAgreementFromLog,
  fetchCurrentDocuments,
  readLocalAgreement,
  recordConsent,
  writeLocalAgreement,
} from './consentStore';
import { googleIdToken, googleSignOut, hasGoogleConfig } from './googleAuth';

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'signedOut'; expired: boolean }
  | {
      status: 'needsConsent';
      user: AuthUser;
      need: Exclude<ConsentNeed, { kind: 'none' }>;
      /** Null offline: the screen shows the bundled texts and asks again once online. */
      documents: LegalDocument[] | null;
    }
  | { status: 'signedIn'; user: AuthUser };

export type SignInOutcome =
  | 'done'
  | 'cancelled'
  | 'offline'
  | 'playServicesUnavailable'
  | 'error'
  /** The sheet was gone by the time the server answered; the session was dropped. */
  | 'abandoned';

export type ConsentOutcome = 'done' | 'offline' | 'stale' | 'error';

/** A short message after an account change, shown as a toast (design 3.2, 5.2). */
export type AuthNotice = { kind: 'signedIn'; name: string } | { kind: 'signedOut' } | null;

interface AuthContextValue {
  state: AuthState;
  notice: AuthNotice;
  /** `onExchangeStarted` fires once Google has answered; from then on the sheet can't be dismissed (design 5.5). */
  signInWithGoogle: (onExchangeStarted: () => void) => Promise<SignInOutcome>;
  /** The sign-in sheet closed: a sign-in still in flight must not leave a session behind. */
  abandonSignIn: () => void;
  submitConsent: (choices: { marketing?: boolean; analytics?: boolean }) => Promise<ConsentOutcome>;
  signOut: () => Promise<void>;
  clearNotice: () => void;
  /** The "sign-in expired" sheet was seen and closed. */
  acknowledgeExpiry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

function toAuthUser(user: User): AuthUser {
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  return { id: user.id, name: meta?.full_name ?? meta?.name ?? null, email: user.email ?? null };
}

/**
 * The signed-in user's name and id, kept on the device. Offline, an expired
 * access token can't be refreshed and getSession() answers with no session,
 * though the stored session is intact: this keeps the user signed in (AC-19).
 */
const LAST_USER_KEY = 'auth.lastUser.v1';

async function readLastUser(): Promise<AuthUser | null> {
  try {
    const stored = await AsyncStorage.getItem(LAST_USER_KEY);
    const parsed = stored ? (JSON.parse(stored) as Partial<AuthUser>) : null;
    return typeof parsed?.id === 'string'
      ? { id: parsed.id, name: parsed.name ?? null, email: parsed.email ?? null }
      : null;
  } catch {
    return null;
  }
}

/** AC-18 re-checks on returning to the app, at most this often (one request per user per window). */
const DOCUMENT_RECHECK_MS = 15 * 60 * 1000;

/** The offline consent screen asks for the documents again at most this often when the network returns. */
const RECONNECT_RETRY_MS = 30 * 1000;

/** What settle() decided; null when a sign-out made the answer irrelevant. */
type Settled = { signedIn: boolean; haveDocuments: boolean } | null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    supabase && hasGoogleConfig ? { status: 'loading' } : { status: 'unavailable' },
  );
  const [notice, setNotice] = useState<AuthNotice>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  /** Bumped by every sign-out; async results from an older generation are dropped. */
  const generation = useRef(0);
  const signingOut = useRef(false);
  const signInInFlight = useRef(false);
  const abandoned = useRef(false);
  const lastDocumentCheck = useRef(0);

  /** Decides between the consent screen and the globe for a signed-in user. */
  const settle = useCallback(async (user: AuthUser): Promise<Settled> => {
    const gen = generation.current;
    void AsyncStorage.setItem(LAST_USER_KEY, JSON.stringify(user)).catch(() => {});
    let agreed = await readLocalAgreement(user.id);
    const documents = await fetchCurrentDocuments();
    if (documents) lastDocumentCheck.current = Date.now();
    if (!agreed && documents) {
      // A returning user on a new device: the server's log already has it.
      agreed = await fetchAgreementFromLog();
      if (agreed) await writeLocalAgreement(user.id, agreed);
    }
    if (gen !== generation.current) return null;
    const need = consentNeed(agreed, documents);
    setState(
      need.kind === 'none'
        ? { status: 'signedIn', user }
        : { status: 'needsConsent', user, need, documents },
    );
    return { signedIn: need.kind === 'none', haveDocuments: documents !== null };
  }, []);

  /** Ends every in-flight flow and forgets the user on this device. */
  const forgetUser = useCallback(() => {
    generation.current += 1;
    void AsyncStorage.removeItem(LAST_USER_KEY).catch(() => {});
  }, []);

  // The stored session at launch, and session changes the user didn't make here.
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    // Listen first, so a sign-out during initialisation is never missed.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      // supabase-js signs out by itself when the refresh token is rejected
      // (invalid_grant): that is "expired", unlike a sign-out the user chose.
      // Network failures don't sign out, so offline launches stay signed in (AC-19).
      if (event === 'SIGNED_OUT' && !signingOut.current) {
        forgetUser();
        setState({ status: 'signedOut', expired: true });
        return;
      }
      // A session that came back by itself (refreshed once the network
      // returned) while the app showed "signed out".
      if (
        (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
        session &&
        !signInInFlight.current &&
        stateRef.current.status === 'signedOut' &&
        !stateRef.current.expired
      ) {
        void settle(toAuthUser(session.user));
      }
    });
    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (data.session) {
        await settle(toAuthUser(data.session.user));
        return;
      }
      // Offline with an expired access token: the session is still stored.
      if (error && isAuthRetryableFetchError(error)) {
        const lastUser = await readLastUser();
        if (lastUser) {
          await settle(lastUser);
          return;
        }
      }
      // An "expired" sign-out may already have arrived during initialisation (AC-20).
      setState((current) =>
        current.status === 'signedOut' ? current : { status: 'signedOut', expired: false },
      );
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [settle, forgetUser]);

  // AC-18: a newer document is noticed on returning to the app (throttled).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (appState) => {
      const current = stateRef.current;
      if (appState !== 'active' || current.status !== 'signedIn') return;
      if (Date.now() - lastDocumentCheck.current < DOCUMENT_RECHECK_MS) return;
      void settle(current.user);
    });
    return () => subscription.remove();
  }, [settle]);

  // Offline consent screen: once the network is back, show the real documents.
  // Keyed on the user id alone, so a failed retry (a new state object) doesn't
  // resubscribe; only a disconnected → connected change retries, at most every
  // 30 s, since NetInfo answers at once on subscribing (review R2-1).
  const waitingForDocuments =
    state.status === 'needsConsent' && !state.documents ? state.user.id : null;
  useEffect(() => {
    if (!waitingForDocuments) return;
    let wasConnected: boolean | null = null;
    let lastTry = 0;
    return NetInfo.addEventListener((net) => {
      const connected = net.isConnected === true;
      const cameBack = wasConnected === false && connected;
      wasConnected = connected;
      if (!cameBack || Date.now() - lastTry < RECONNECT_RETRY_MS) return;
      const current = stateRef.current;
      if (current.status !== 'needsConsent' || current.documents) return;
      lastTry = Date.now();
      void settle(current.user);
    });
  }, [waitingForDocuments, settle]);

  const signOut = useCallback(async () => {
    forgetUser();
    signingOut.current = true;
    try {
      // Local scope works offline; revoking on the server is best effort.
      await supabase?.auth.signOut({ scope: 'local' });
      await googleSignOut();
    } finally {
      signingOut.current = false;
    }
    setState({ status: 'signedOut', expired: false });
    setNotice({ kind: 'signedOut' });
  }, [forgetUser]);

  const signInWithGoogle = useCallback(
    async (onExchangeStarted: () => void): Promise<SignInOutcome> => {
      if (!supabase) return 'error';
      abandoned.current = false;
      const net = await NetInfo.fetch();
      if (net.isConnected === false) return 'offline';

      const google = await googleIdToken();
      if (google.kind === 'cancelled') return 'cancelled';
      if (google.kind === 'network') return 'offline';
      if (google.kind === 'playServicesUnavailable') return 'playServicesUnavailable';
      if (google.kind === 'error') {
        console.error('[auth] Google sign-in failed', google.error);
        return 'error';
      }

      onExchangeStarted();
      signInInFlight.current = true;
      try {
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: google.idToken,
        });
        if (error && isAuthRetryableFetchError(error)) return 'offline';
        if (error || !data.user) {
          console.error('[auth] Supabase sign-in failed', error);
          return 'error';
        }
        // Design 4.2: never a signed-in user who didn't see the consent screen.
        if (abandoned.current) {
          forgetUser();
          signingOut.current = true;
          try {
            await supabase.auth.signOut({ scope: 'local' });
            await googleSignOut();
          } finally {
            signingOut.current = false;
          }
          return 'abandoned';
        }
        const user = toAuthUser(data.user);
        const settled = await settle(user);
        if (settled?.signedIn) setNotice({ kind: 'signedIn', name: user.name ?? user.email ?? '' });
        return 'done';
      } finally {
        signInInFlight.current = false;
      }
    },
    [settle, forgetUser],
  );

  const abandonSignIn = useCallback(() => {
    abandoned.current = true;
  }, []);

  const submitConsent = useCallback(
    async (choices: { marketing?: boolean; analytics?: boolean }): Promise<ConsentOutcome> => {
      const current = stateRef.current;
      if (current.status !== 'needsConsent') return 'error';
      const gen = generation.current;
      const net = await NetInfo.fetch();
      if (net.isConnected === false) return 'offline';
      // The screen was showing the bundled texts (offline): show the real
      // documents first, and let the user confirm what they have now seen (AC-16).
      if (!current.documents) {
        const settled = await settle(current.user);
        if (!settled) return 'error';
        if (settled.signedIn) return 'done';
        // Online, but the server still didn't answer (review R2-2).
        return settled.haveDocuments ? 'stale' : 'offline';
      }
      const documents = current.documents;

      const result = await recordConsent({ documents, ...choices });
      if (gen !== generation.current) return 'error';
      if (!result.ok) {
        if (isAuthRetryableFetchError(result.error)) return 'offline';
        // A version published while the screen was open: show the new one.
        const code = (result.error as { code?: string } | null)?.code;
        if (code === '22023') {
          await settle(current.user);
          return 'stale';
        }
        console.error('[auth] could not record consent', result.error);
        return 'error';
      }
      const terms = documents.find((d) => d.docType === 'terms');
      const privacy = documents.find((d) => d.docType === 'privacy');
      if (!terms || !privacy) return 'error';
      await writeLocalAgreement(current.user.id, {
        terms: terms.version,
        privacy: privacy.version,
      });
      if (gen !== generation.current) return 'error';
      setState({ status: 'signedIn', user: current.user });
      setNotice({ kind: 'signedIn', name: current.user.name ?? current.user.email ?? '' });
      return 'done';
    },
    [settle],
  );

  const clearNotice = useCallback(() => setNotice(null), []);
  const acknowledgeExpiry = useCallback(() => {
    setState((current) =>
      current.status === 'signedOut' && current.expired
        ? { status: 'signedOut', expired: false }
        : current,
    );
  }, []);

  const value = useMemo(
    () => ({
      state,
      notice,
      signInWithGoogle,
      abandonSignIn,
      submitConsent,
      signOut,
      clearNotice,
      acknowledgeExpiry,
    }),
    [
      state,
      notice,
      signInWithGoogle,
      abandonSignIn,
      submitConsent,
      signOut,
      clearNotice,
      acknowledgeExpiry,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
