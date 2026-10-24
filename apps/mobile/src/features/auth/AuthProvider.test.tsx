import NetInfo from '@react-native-community/netinfo';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthProvider, useAuth } from './AuthProvider';
import type { LegalDocument } from './consentStatus';

const mockSupabase = {
  session: null as null | { user: object },
  listeners: [] as ((event: string) => void)[],
  auth: {
    getSession: jest.fn(async () => ({ data: { session: mockSupabase.session } })),
    onAuthStateChange: jest.fn((listener: (event: string) => void) => {
      mockSupabase.listeners.push(listener);
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    signInWithIdToken: jest.fn(),
    signOut: jest.fn(async () => {
      mockSupabase.listeners.forEach((listener) => listener('SIGNED_OUT'));
      return { error: null };
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
}));

const googleUser = {
  id: 'user-1',
  email: 'dana@example.test',
  user_metadata: { full_name: 'דנה כהן' },
};

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.session = null;
  mockSupabase.listeners = [];
  mockSupabase.auth.signInWithIdToken.mockResolvedValue({
    data: { user: googleUser },
    error: null,
  });
  mockGoogle.result = { kind: 'token', idToken: 'google-id-token' };
  mockStore.local = null;
  mockStore.log = null;
  mockStore.current = docs;
  mockStore.record = { ok: true };
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true } as never);
});

async function signedOutHook() {
  const hook = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.state.status).toBe('signedOut'));
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
    mockSupabase.session = { user: googleUser };
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
    mockSupabase.session = { user: googleUser };
    mockStore.local = { terms: 0, privacy: 0 };
    mockStore.current = null;
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));
  });

  it('tells "expired" apart from a sign-out the user chose (AC-20)', async () => {
    mockSupabase.session = { user: googleUser };
    mockStore.local = { terms: 0, privacy: 0 };
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));

    // supabase-js signs out by itself when the refresh token is rejected.
    await act(async () => mockSupabase.listeners.forEach((listener) => listener('SIGNED_OUT')));
    expect(result.current.state).toEqual({ status: 'signedOut', expired: true });

    await act(async () => result.current.acknowledgeExpiry());
    expect(result.current.state).toEqual({ status: 'signedOut', expired: false });
  });

  it('signs out locally (works offline) and confirms with a toast', async () => {
    mockSupabase.session = { user: googleUser };
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
});
