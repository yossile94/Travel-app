import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthProvider, useAuth } from './AuthProvider';
import type { LegalDocument } from './consentStatus';

type Listener = (event: string) => void;
const mockState = {
  session: null as null | { user: object },
  listeners: [] as Listener[],
};
const mockSupabase = {
  auth: {
    getSession: jest.fn(async (): Promise<{ data: { session: unknown }; error: unknown }> => ({
      data: { session: mockState.session },
      error: null,
    })),
    onAuthStateChange: jest.fn((listener: Listener) => {
      mockState.listeners.push(listener);
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    signInWithIdToken: jest.fn(),
    refreshSession: jest.fn(async () => ({ error: null as unknown })),
    signOut: jest.fn(async () => {
      mockState.listeners.forEach((listener: Listener) => listener('SIGNED_OUT'));
      return { error: null as unknown };
    }),
  },
};
// Read lazily: the mock object is created after jest.mock is hoisted.
jest.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockSupabase;
  },
}));

const mockGoogle = { result: { kind: 'token', idToken: 'google-id-token' } as object };
jest.mock('./googleAuth', () => ({
  hasGoogleConfig: true,
  googleIdToken: jest.fn(async () => mockGoogle.result),
  googleSignOut: jest.fn(async () => {}),
  googleRevoke: jest.fn(async () => {}),
}));

const mockAccount = { name: 'דנה' as string | null };
jest.mock('@/features/account/accountApi', () => ({
  ensureProfile: jest.fn(async () => {}),
  loadDisplayName: jest.fn(async () => mockAccount.name),
  saveDisplayName: jest.fn(async () => 'ok'),
  removeLocalChoices: jest.fn(async () => {}),
}));
const mockDeletion = { answers: ['deleted'] as string[] };
jest.mock('@/features/account/deleteAccountApi', () => ({
  requestDeletion: jest.fn(async () => mockDeletion.answers.shift() ?? 'error'),
}));

const docs: LegalDocument[] = [
  { docType: 'terms', version: 0, url: null, publishedAt: '2026-10-24T00:00:00Z' },
  { docType: 'privacy', version: 0, url: null, publishedAt: '2026-10-24T00:00:00Z' },
];
const mockStore = {
  local: null as null | { terms: number; privacy: number },
  log: null as null | { terms: number; privacy: number },
  current: docs as LegalDocument[] | null,
  record: { ok: true } as { ok: true } | { ok: false; error: unknown },
};
jest.mock('./consentStore', () => ({
  readLocalAgreement: jest.fn(async () => mockStore.local),
  writeLocalAgreement: jest.fn(async (_id: string, agreed: { terms: number; privacy: number }) => {
    mockStore.local = agreed;
  }),
  fetchCurrentDocuments: jest.fn(async () => mockStore.current),
  fetchAgreementFromLog: jest.fn(async () => mockStore.log),
  recordConsent: jest.fn(async () => mockStore.record),
  removeLocalAgreement: jest.fn(async () => {}),
}));

const googleUser = {
  id: 'user-1',
  email: 'dana@example.test',
  user_metadata: { full_name: 'דנה כהן' },
};

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSupabase.auth.getSession.mockImplementation(async () => ({
    data: { session: mockState.session },
    error: null,
  }));
  mockState.session = null;
  mockState.listeners = [];
  mockSupabase.auth.signInWithIdToken.mockResolvedValue({
    data: { user: googleUser },
    error: null,
  });
  mockGoogle.result = { kind: 'token', idToken: 'google-id-token' };
  mockStore.local = null;
  mockStore.log = null;
  mockStore.current = docs;
  mockStore.record = { ok: true };
  mockAccount.name = 'דנה';
  mockDeletion.answers = ['deleted'];
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true } as never);
  jest.mocked(NetInfo.addEventListener).mockImplementation(() => jest.fn());
});

async function signedOutHook() {
  const hook = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.state.status).toBe('signedOut'));
  return hook;
}

/** Signed in with consent on record. */
async function signedInHook() {
  mockStore.log = { terms: 0, privacy: 0 };
  const hook = await signedOutHook();
  await act(async () => {
    await hook.result.current.signInWithGoogle(() => {});
  });
  await waitFor(() => expect(hook.result.current.state.status).toBe('signedIn'));
  return hook;
}

describe('AuthProvider (sprint 1 F-003a)', () => {
  it('starts signed out without a stored session, and the globe never waits for it', async () => {
    const { result } = await signedOutHook();
    expect(result.current.state).toEqual({ status: 'signedOut', expired: false });
  });

  it('asks for consent after a first sign-in (AC-15, AC-16)', async () => {
    const { result } = await signedOutHook();
    const onExchange = jest.fn();
    let outcome = '';
    await act(async () => {
      outcome = await result.current.signInWithGoogle(onExchange);
    });
    expect(outcome).toBe('done');
    expect(onExchange).toHaveBeenCalled();
    expect(mockSupabase.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'google-id-token',
    });
    expect(result.current.state).toMatchObject({ status: 'needsConsent', need: { kind: 'first' } });
  });

  it('lets a returning user on a new device straight in, from the server log', async () => {
    mockStore.log = { terms: 0, privacy: 0 };
    const { result } = await signedOutHook();
    await act(async () => {
      await result.current.signInWithGoogle(() => {});
    });
    expect(result.current.state).toMatchObject({ status: 'signedIn' });
    expect(result.current.notice).toEqual({ kind: 'signedIn', name: 'דנה כהן' });
  });

  it('records consent, keeps a copy on the device, and lets the user in (AC-17)', async () => {
    const { result } = await signedOutHook();
    await act(async () => {
      await result.current.signInWithGoogle(() => {});
    });
    let outcome = '';
    await act(async () => {
      outcome = await result.current.submitConsent({ marketing: false, analytics: true });
    });
    expect(outcome).toBe('done');
    expect(mockStore.local).toEqual({ terms: 0, privacy: 0 });
    expect(result.current.state).toMatchObject({ status: 'signedIn' });
  });

  it('shows the new version when one was published while the screen was open (AC-18)', async () => {
    const { result } = await signedOutHook();
    await act(async () => {
      await result.current.signInWithGoogle(() => {});
    });
    mockStore.record = { ok: false, error: { code: '22023' } };
    mockStore.current = [docs[0]!, { ...docs[1]!, version: 1 }];
    let outcome = '';
    await act(async () => {
      outcome = await result.current.submitConsent({});
    });
    expect(outcome).toBe('stale');
    expect(result.current.state).toMatchObject({
      status: 'needsConsent',
      documents: mockStore.current,
    });
  });

  it("can't save consent offline, but keeps the screen (design 5.2)", async () => {
    const { result } = await signedOutHook();
    await act(async () => {
      await result.current.signInWithGoogle(() => {});
    });
    jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false } as never);
    let outcome = '';
    await act(async () => {
      outcome = await result.current.submitConsent({});
    });
    expect(outcome).toBe('offline');
    expect(result.current.state.status).toBe('needsConsent');
  });

  it('drops a session that arrives after the sheet was closed (design 5.5)', async () => {
    const { result } = await signedOutHook();
    mockSupabase.auth.signInWithIdToken.mockImplementation(async () => {
      result.current.abandonSignIn();
      return { data: { user: googleUser }, error: null };
    });
    let outcome = '';
    await act(async () => {
      outcome = await result.current.signInWithGoogle(() => {});
    });
    expect(outcome).toBe('abandoned');
    expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(result.current.state.status).toBe('signedOut');
  });

  it.each([
    [{ kind: 'cancelled' }, 'cancelled'],
    [{ kind: 'network' }, 'offline'],
    [{ kind: 'playServicesUnavailable' }, 'playServicesUnavailable'],
  ])(
    'reports %o from Google as "%s" without touching Supabase (AC-20)',
    async (google, expected) => {
      mockGoogle.result = google;
      const { result } = await signedOutHook();
      let outcome = '';
      await act(async () => {
        outcome = await result.current.signInWithGoogle(() => {});
      });
      expect(outcome).toBe(expected);
      expect(mockSupabase.auth.signInWithIdToken).not.toHaveBeenCalled();
    },
  );

  it('says "offline" before even asking Google when there is no network (AC-20)', async () => {
    jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false } as never);
    const { result } = await signedOutHook();
    let outcome = '';
    await act(async () => {
      outcome = await result.current.signInWithGoogle(() => {});
    });
    expect(outcome).toBe('offline');
  });

  it('opens with consent at launch when the device has no record, even offline (AC-18a)', async () => {
    mockState.session = { user: googleUser };
    mockStore.current = null;
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'needsConsent',
        need: { kind: 'first' },
      }),
    );
  });

  it('stays signed in offline once consent is on record (AC-19)', async () => {
    mockState.session = { user: googleUser };
    mockStore.local = { terms: 0, privacy: 0 };
    mockStore.current = null;
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));
  });

  it('tells "expired" apart from a sign-out the user chose (AC-20)', async () => {
    mockState.session = { user: googleUser };
    mockStore.local = { terms: 0, privacy: 0 };
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));

    // supabase-js signs out by itself when the refresh token is rejected.
    await act(async () =>
      mockState.listeners.forEach((listener: Listener) => listener('SIGNED_OUT')),
    );
    expect(result.current.state).toEqual({ status: 'signedOut', expired: true });

    await act(async () => result.current.acknowledgeExpiry());
    expect(result.current.state).toEqual({ status: 'signedOut', expired: false });
  });

  it('signs out locally (works offline) and confirms with a toast', async () => {
    mockState.session = { user: googleUser };
    mockStore.local = { terms: 0, privacy: 0 };
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));
    await act(async () => {
      await result.current.signOut();
    });
    expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(result.current.state).toEqual({ status: 'signedOut', expired: false });
    expect(result.current.notice).toEqual({ kind: 'signedOut' });
  });

  it('removes the stored session even when supabase-js returns early (QA D-1, AC-8)', async () => {
    mockState.session = { user: googleUser };
    mockStore.local = { terms: 0, privacy: 0 };
    await AsyncStorage.setItem('sb-ref-auth-token', 'encrypted-session');
    await AsyncStorage.setItem('sb-ref-auth-token-user', 'encrypted-user');
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));
    // Offline with an expired token: auth-js answers with an error and keeps the session.
    mockSupabase.auth.signOut.mockImplementationOnce(async () => ({
      error: new AuthRetryableFetchError('Network request failed', 0),
    }));
    await act(async () => {
      await result.current.signOut();
    });
    expect(await AsyncStorage.getItem('sb-ref-auth-token')).toBeNull();
    expect(await AsyncStorage.getItem('sb-ref-auth-token-user')).toBeNull();
    expect(result.current.state).toEqual({ status: 'signedOut', expired: false });
  });

  describe('tech-lead review round 1', () => {
    const offline = () => new AuthRetryableFetchError('Network request failed', 0);

    it("stays signed in when an expired token can't be refreshed offline (AC-19)", async () => {
      await AsyncStorage.setItem(
        'auth.lastUser.v1',
        JSON.stringify({ id: 'user-1', name: 'דנה כהן', email: 'dana@example.test' }),
      );
      mockStore.local = { terms: 0, privacy: 0 };
      mockStore.current = null;
      mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: offline() });
      const { result } = await renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.state.status).toBe('signedIn'));
    });

    it('still blocks with consent offline in that case when nothing is on record (AC-18a)', async () => {
      await AsyncStorage.setItem('auth.lastUser.v1', JSON.stringify({ id: 'user-1' }));
      mockStore.current = null;
      mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: offline() });
      const { result } = await renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.state.status).toBe('needsConsent'));
    });

    it('keeps "expired" when it arrives before getSession answers (AC-20)', async () => {
      mockSupabase.auth.getSession.mockImplementation(async () => {
        // supabase-js finishes initialising (and signs out) before getSession resolves.
        await Promise.resolve();
        mockState.listeners.forEach((listener: Listener) => listener('SIGNED_OUT'));
        return { data: { session: null }, error: null };
      });
      const { result } = await renderHook(() => useAuth(), { wrapper });
      await waitFor(() =>
        expect(result.current.state).toEqual({ status: 'signedOut', expired: true }),
      );
    });

    it('never brings back "signed in" from work that finishes after a sign-out', async () => {
      const { result } = await signedOutHook();
      let release: () => void = () => {};
      jest
        .mocked(jest.requireMock('./consentStore').fetchCurrentDocuments)
        .mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(docs))));
      let signIn: Promise<string> = Promise.resolve('');
      await act(async () => {
        signIn = result.current.signInWithGoogle(() => {});
        await Promise.resolve();
      });
      await act(async () => {
        await result.current.signOut();
      });
      await act(async () => {
        release();
        await signIn;
      });
      expect(result.current.state.status).toBe('signedOut');
    });

    it('says "offline" when the network drops between Google and Supabase (AC-20)', async () => {
      mockSupabase.auth.signInWithIdToken.mockResolvedValue({
        data: { user: null },
        error: offline(),
      });
      const { result } = await signedOutHook();
      let outcome = '';
      await act(async () => {
        outcome = await result.current.signInWithGoogle(() => {});
      });
      expect(outcome).toBe('offline');
    });

    it('forgets the picked Google account when the server refuses the sign-in', async () => {
      mockSupabase.auth.signInWithIdToken.mockResolvedValue({
        data: { user: null },
        error: { status: 400, code: 'provider_disabled' },
      });
      const { result } = await signedOutHook();
      let outcome = '';
      await act(async () => {
        outcome = await result.current.signInWithGoogle(() => {});
      });
      expect(outcome).toBe('error');
      expect(jest.requireMock('./googleAuth').googleSignOut).toHaveBeenCalled();
      expect(result.current.state.status).toBe('signedOut');
    });

    it('shows the real documents before recording consent made on the offline screen (AC-16)', async () => {
      mockStore.current = null;
      const { result } = await signedOutHook();
      await act(async () => {
        await result.current.signInWithGoogle(() => {});
      });
      expect(result.current.state).toMatchObject({ status: 'needsConsent', documents: null });

      mockStore.current = docs;
      let outcome = '';
      await act(async () => {
        outcome = await result.current.submitConsent({});
      });
      expect(outcome).toBe('stale');
      expect(jest.requireMock('./consentStore').recordConsent).not.toHaveBeenCalled();
      expect(result.current.state).toMatchObject({ status: 'needsConsent', documents: docs });
    });

    it('says "offline", not "stale", when online but the documents still fail to load (review R2-2)', async () => {
      mockStore.current = null;
      const { result } = await signedOutHook();
      await act(async () => {
        await result.current.signInWithGoogle(() => {});
      });
      let outcome = '';
      await act(async () => {
        outcome = await result.current.submitConsent({});
      });
      expect(outcome).toBe('offline');
      expect(result.current.state).toMatchObject({ status: 'needsConsent', documents: null });
    });

    it('asks for the documents once per reconnection, never in a loop (review R2-1)', async () => {
      const listeners: ((net: { isConnected: boolean }) => void)[] = [];
      // Like NetInfo: the listener is called at once with the current state.
      jest.mocked(NetInfo.addEventListener).mockImplementation((listener) => {
        listeners.push(listener as never);
        (listener as (net: { isConnected: boolean }) => void)({ isConnected: true });
        return jest.fn();
      });
      mockStore.current = null;
      const { fetchCurrentDocuments } = jest.requireMock('./consentStore');
      const { result } = await signedOutHook();
      await act(async () => {
        await result.current.signInWithGoogle(() => {});
      });
      expect(result.current.state).toMatchObject({ status: 'needsConsent', documents: null });
      const afterSignIn = jest.mocked(fetchCurrentDocuments).mock.calls.length;

      // The immediate "connected" answer on subscribing asks nothing.
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchCurrentDocuments).toHaveBeenCalledTimes(afterSignIn);
      expect(listeners).toHaveLength(1);

      // Disconnected, then back: one request, which fails again without resubscribing.
      const listener = listeners[0]!;
      await act(async () => {
        listener({ isConnected: false });
        listener({ isConnected: true });
      });
      expect(fetchCurrentDocuments).toHaveBeenCalledTimes(afterSignIn + 1);
      expect(listeners).toHaveLength(1);

      // A flapping connection within 30 s doesn't ask again at once...
      jest.useFakeTimers({ now: Date.now() });
      try {
        await act(async () => {
          listener({ isConnected: false });
          listener({ isConnected: true });
          listener({ isConnected: false });
          listener({ isConnected: true });
        });
        expect(fetchCurrentDocuments).toHaveBeenCalledTimes(afterSignIn + 1);

        // ...but once, when the window ends, in case the first try came too early.
        await act(async () => {
          jest.advanceTimersByTime(30_000);
        });
        expect(fetchCurrentDocuments).toHaveBeenCalledTimes(afterSignIn + 2);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

describe('AuthProvider: account (sprint 2 F-004, F-005)', () => {
  const googleAuth = jest.requireMock<Record<string, jest.Mock>>('./googleAuth');
  const store = jest.requireMock<Record<string, jest.Mock>>('./consentStore');
  const account = jest.requireMock<Record<string, jest.Mock>>('@/features/account/accountApi');
  const deletion = jest.requireMock<Record<string, jest.Mock>>(
    '@/features/account/deleteAccountApi',
  );

  it('creates a missing profile, then shows the display name, and renames (AC-12)', async () => {
    const { result } = await signedInHook();
    expect(account.ensureProfile).toHaveBeenCalledWith('user-1', 'דנה כהן', 'dana@example.test');
    await waitFor(() => expect(result.current.displayName).toBe('דנה'));
    let outcome = '';
    await act(async () => {
      outcome = await result.current.renameProfile('  דנה ל  ');
    });
    expect(outcome).toBe('ok');
    expect(result.current.displayName).toBe('דנה ל');
  });

  it('deletes with a fresh Google token, never touching the session, then wipes the device (AC-15, AC-16, AC-18)', async () => {
    const { result } = await signedInHook();
    jest.clearAllMocks();
    const onDeleting = jest.fn();
    let outcome = '';
    await act(async () => {
      outcome = await result.current.deleteAccount(onDeleting);
    });
    expect(outcome).toBe('deleted');
    // The chooser every time: sign out of Google before asking (design 11.2).
    expect(googleAuth.googleSignOut!.mock.invocationCallOrder[0]).toBeLessThan(
      googleAuth.googleIdToken!.mock.invocationCallOrder[0]!,
    );
    expect(mockSupabase.auth.signInWithIdToken).not.toHaveBeenCalled();
    expect(onDeleting).toHaveBeenCalled();
    expect(deletion.requestDeletion).toHaveBeenCalledWith('google-id-token');
    expect(store.removeLocalAgreement).toHaveBeenCalledWith('user-1');
    expect(account.removeLocalChoices).toHaveBeenCalledWith('user-1');
    expect(googleAuth.googleRevoke).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('auth.lastUser.v1')).toBeNull();
    expect(result.current.state).toEqual({ status: 'signedOut', expired: false });
    expect(result.current.notice).toEqual({ kind: 'deleted' });
    expect(result.current.displayName).toBeNull();
  });

  it('a defined refusal leaves the user signed in, and nothing is wiped', async () => {
    const { result } = await signedInHook();
    mockDeletion.answers = ['wrongAccount'];
    let outcome = '';
    await act(async () => {
      outcome = await result.current.deleteAccount(() => {});
    });
    expect(outcome).toBe('wrongAccount');
    expect(result.current.state.status).toBe('signedIn');
    expect(store.removeLocalAgreement).not.toHaveBeenCalled();
    // The flag is off: a later sign-out the user didn't make is "expired", not "deleted".
    await act(async () => mockState.listeners.forEach((listener) => listener('SIGNED_OUT')));
    expect(result.current.state).toEqual({ status: 'signedOut', expired: true });
    expect(result.current.notice).not.toEqual({ kind: 'deleted' });
  });

  it('no answer keeps the flag on: a sign-out that follows means it was deleted (design 11.3)', async () => {
    const { result } = await signedInHook();
    mockDeletion.answers = ['noAnswer'];
    let outcome = '';
    await act(async () => {
      outcome = await result.current.deleteAccount(() => {});
    });
    expect(outcome).toBe('noAnswer');
    expect(result.current.state.status).toBe('signedIn');
    await act(async () => mockState.listeners.forEach((listener) => listener('SIGNED_OUT')));
    await waitFor(() => expect(result.current.notice).toEqual({ kind: 'deleted' }));
    expect(result.current.state).toEqual({ status: 'signedOut', expired: false });
    expect(store.removeLocalAgreement).toHaveBeenCalledWith('user-1');
  });

  it('401 refreshes the session and retries once; 401 again is "expired", never "deleted"', async () => {
    const { result } = await signedInHook();
    mockDeletion.answers = ['unauthorized', 'unauthorized'];
    let outcome = '';
    await act(async () => {
      outcome = await result.current.deleteAccount(() => {});
    });
    expect(mockSupabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(deletion.requestDeletion).toHaveBeenCalledTimes(2);
    expect(outcome).toBe('expired');
    expect(result.current.state.status).toBe('signedIn');
  });

  it('401, and the refresh signs out because the user is gone: "deleted" only, never "expired" too', async () => {
    const { result } = await signedInHook();
    mockDeletion.answers = ['unauthorized'];
    mockSupabase.auth.refreshSession.mockImplementationOnce(async () => {
      mockState.listeners.forEach((listener) => listener('SIGNED_OUT'));
      return { error: { name: 'AuthApiError' } };
    });
    let outcome = '';
    await act(async () => {
      outcome = await result.current.deleteAccount(() => {});
    });
    expect(outcome).toBe('deleted');
    expect(result.current.state).toEqual({ status: 'signedOut', expired: false });
    expect(result.current.notice).toEqual({ kind: 'deleted' });
  });

  it('a second tap while deleting starts nothing (review)', async () => {
    const { result } = await signedInHook();
    googleAuth.googleIdToken!.mockClear();
    let release: () => void = () => {};
    deletion.requestDeletion!.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve('deleted'))),
    );
    let first: Promise<string> = Promise.resolve('');
    let second = '';
    await act(async () => {
      first = result.current.deleteAccount(() => {});
      second = await result.current.deleteAccount(() => {});
    });
    expect(second).toBe('inProgress');
    await act(async () => {
      release();
      expect(await first).toBe('deleted');
    });
    expect(googleAuth.googleIdToken).toHaveBeenCalledTimes(1);
  });

  it('the answer and a sign-out both finishing a deletion wipe once (review)', async () => {
    const { result } = await signedInHook();
    jest.clearAllMocks();
    deletion.requestDeletion!.mockImplementationOnce(async () => {
      // Auto-refresh found the user gone while the answer was on its way.
      mockState.listeners.forEach((listener) => listener('SIGNED_OUT'));
      return 'deleted';
    });
    let outcome = '';
    await act(async () => {
      outcome = await result.current.deleteAccount(() => {});
    });
    expect(outcome).toBe('deleted');
    expect(googleAuth.googleRevoke).toHaveBeenCalledTimes(1);
    expect(result.current.notice).toEqual({ kind: 'deleted' });
  });

  it('offline: nothing is asked of Google or the server (AC-15)', async () => {
    const { result } = await signedInHook();
    jest.clearAllMocks();
    jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: false } as never);
    let outcome = '';
    await act(async () => {
      outcome = await result.current.deleteAccount(() => {});
    });
    expect(outcome).toBe('offline');
    expect(googleAuth.googleIdToken).not.toHaveBeenCalled();
    expect(deletion.requestDeletion).not.toHaveBeenCalled();
  });

  it("a sign-out the user didn't make wipes the consent copies too (AC-8, AC-16)", async () => {
    const { result } = await signedInHook();
    await act(async () => mockState.listeners.forEach((listener) => listener('SIGNED_OUT')));
    expect(result.current.state).toEqual({ status: 'signedOut', expired: true });
    expect(store.removeLocalAgreement).toHaveBeenCalledWith('user-1');
    expect(account.removeLocalChoices).toHaveBeenCalledWith('user-1');
  });
});
