/**
 * Sign-in and consent state for the whole app (sprint 1 F-003a; design
 * docs/design/sprint-01 sections 3–5). The globe never waits for it: an
 * account is optional until personal features arrive (decision 4).
 *
 * States: loading → unavailable (not configured) | signedOut | needsConsent |
 * signedIn. A signed-in user without consent on record only ever sees the
 * consent screen, whose one exit is signing out (AC-18a).
 */
import NetInfo from '@react-native-community/netinfo';
import type { User } from '@supabase/supabase-js';
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

const available = Boolean(supabase) && hasGoogleConfig;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(
    available ? { status: 'loading' } : { status: 'unavailable' },
  );
  const [notice, setNotice] = useState<AuthNotice>(null);
  const signingOut = useRef(false);
  const abandoned = useRef(false);

  /** Decides between the consent screen and the globe for a signed-in user. */
  const settle = useCallback(async (user: AuthUser) => {
    let agreed = await readLocalAgreement(user.id);
    const documents = await fetchCurrentDocuments();
    if (!agreed && documents) {
      // A returning user on a new device: the server's log already has it.
      agreed = await fetchAgreementFromLog();
      if (agreed) await writeLocalAgreement(user.id, agreed);
    }
    const need = consentNeed(agreed, documents);
    setState(
      need.kind === 'none'
        ? { status: 'signedIn', user }
        : { status: 'needsConsent', user, need, documents },
    );
    return need.kind === 'none';
  }, []);

  // The stored session at launch, and sign-outs that the user didn't ask for.
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) void settle(toAuthUser(data.session.user));
      else setState({ status: 'signedOut', expired: false });
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      // supabase-js signs out by itself when the refresh token is rejected
      // (invalid_grant): that is "expired", unlike a sign-out the user chose.
      // Network failures don't sign out, so offline launches stay signed in (AC-19).
      if (event === 'SIGNED_OUT' && !signingOut.current) {
        setState({ status: 'signedOut', expired: true });
      }
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [settle]);

  // AC-18: a newer document is noticed at launch and on returning to the app.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState === 'active' && state.status === 'signedIn') void settle(state.user);
    });
    return () => subscription.remove();
  }, [state, settle]);

  const signOut = useCallback(async () => {
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
  }, []);

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
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: google.idToken,
      });
      if (error || !data.user) {
        console.error('[auth] Supabase sign-in failed', error);
        return 'error';
      }
      // Design 4.2: never a signed-in user who didn't see the consent screen.
      if (abandoned.current) {
        signingOut.current = true;
        await supabase.auth.signOut({ scope: 'local' });
        signingOut.current = false;
        return 'abandoned';
      }
      const user = toAuthUser(data.user);
      const upToDate = await settle(user);
      if (upToDate) setNotice({ kind: 'signedIn', name: user.name ?? user.email ?? '' });
      return 'done';
    },
    [settle],
  );

  const abandonSignIn = useCallback(() => {
    abandoned.current = true;
  }, []);

  const submitConsent = useCallback(
    async (choices: { marketing?: boolean; analytics?: boolean }): Promise<ConsentOutcome> => {
      if (state.status !== 'needsConsent') return 'error';
      const net = await NetInfo.fetch();
      if (net.isConnected === false) return 'offline';
      const documents = state.documents ?? (await fetchCurrentDocuments());
      if (!documents) return 'offline';

      const result = await recordConsent({ documents, ...choices });
      if (!result.ok) {
        // A version published while the screen was open: show the new one.
        const code = (result.error as { code?: string } | null)?.code;
        if (code === '22023') {
          await settle(state.user);
          return 'stale';
        }
        console.error('[auth] could not record consent', result.error);
        return 'error';
      }
      const agreed = {
        terms: documents.find((d) => d.docType === 'terms')!.version,
        privacy: documents.find((d) => d.docType === 'privacy')!.version,
      };
      await writeLocalAgreement(state.user.id, agreed);
      setState({ status: 'signedIn', user: state.user });
      setNotice({ kind: 'signedIn', name: state.user.name ?? state.user.email ?? '' });
      return 'done';
    },
    [state, settle],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo(
    () => ({
      state,
      notice,
      signInWithGoogle,
      abandonSignIn,
      submitConsent,
      signOut,
      clearNotice,
    }),
    [state, notice, signInWithGoogle, abandonSignIn, submitConsent, signOut, clearNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
