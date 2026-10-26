import NetInfo from '@react-native-community/netinfo';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { fetchChoices } from './accountApi';
import { requestDeletion } from './deleteAccountApi';
import { buildExport } from './exportData';

/** A query builder that records its calls and answers from `mockAnswer(table, calls)`. */
const mockLog: { table: string; calls: [string, ...unknown[]][] }[] = [];
const mockAnswer = {
  fn: (_table: string, _calls: [string, ...unknown[]][]): { data: unknown; error: unknown } => ({
    data: [],
    error: null,
  }),
};
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const entry = { table, calls: [] as [string, ...unknown[]][] };
      mockLog.push(entry);
      const builder: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'gt', 'in', 'order', 'limit', 'upsert']) {
        builder[name] = (...args: unknown[]) => {
          entry.calls.push([name, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = () => Promise.resolve(mockAnswer.fn(table, entry.calls));
      builder.then = (resolve: (value: unknown) => void) =>
        resolve(mockAnswer.fn(table, entry.calls));
      return builder;
    },
    auth: {
      getUser: async () => ({
        data: {
          user: {
            email: 'dana@example.test',
            app_metadata: { provider: 'google' },
            created_at: '2026-10-01T00:00:00Z',
          },
        },
        error: null,
      }),
    },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: {} }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));

const user = { id: 'user-1', name: 'דנה', email: 'dana@example.test' };

beforeEach(() => {
  mockLog.length = 0;
  mockInvoke.mockReset();
  jest.mocked(NetInfo.fetch).mockResolvedValue({ isConnected: true } as never);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('optional choices from the log (AC-13)', () => {
  it('reads the latest row of each choice separately', async () => {
    mockAnswer.fn = (_t, calls) => {
      const type = calls.find((c) => c[0] === 'eq')?.[2];
      return { data: [{ action: type === 'analytics' ? 'granted' : 'withdrawn' }], error: null };
    };
    expect(await fetchChoices()).toEqual({ marketing: false, analytics: true });
    expect(mockLog).toHaveLength(2);
    for (const entry of mockLog) expect(entry.calls).toContainEqual(['limit', 1]);
  });

  it('never asked is false; a failed read is unknown, not false', async () => {
    mockAnswer.fn = () => ({ data: [], error: null });
    expect(await fetchChoices()).toEqual({ marketing: false, analytics: false });
    mockAnswer.fn = () => ({ data: null, error: { code: 'PGRST301' } });
    expect(await fetchChoices()).toBeNull();
  });
});

describe('export (AC-14)', () => {
  const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: from + i + 1 }));

  it('reads every page, for this user only, keyset on id', async () => {
    mockAnswer.fn = (table, calls) => {
      if (table === 'profiles') return { data: { display_name: 'דנה' }, error: null };
      const after = calls.find((c) => c[0] === 'gt')?.[2] as number | undefined;
      // trips: 501 rows (two pages); consents: exactly 500 (one more, empty page).
      const total = table === 'trips' ? 501 : 500;
      const start = after ?? 0;
      return { data: rows(Math.max(0, Math.min(500, total - start)), start), error: null };
    };
    const document = (await buildExport(user, new AbortController().signal)) as {
      trips: unknown[];
      consents: unknown[];
      profile: unknown;
      account: unknown;
    };
    expect(document.trips).toHaveLength(501);
    expect(document.consents).toHaveLength(500);
    expect(document.profile).toEqual({ display_name: 'דנה' });
    expect(document.account).toEqual({
      email: 'dana@example.test',
      sign_in_provider: 'google',
      created_at: '2026-10-01T00:00:00Z',
    });
    const trips = mockLog.filter((e) => e.table === 'trips');
    expect(trips).toHaveLength(2);
    // Sprint 3: each trip carries its travelers and cities.
    const columns = trips[0]!.calls.find((c) => c[0] === 'select')?.[1] as string;
    expect(columns).toContain('trip_travelers(');
    expect(columns).toContain('trip_cities(');
    expect(trips[1]!.calls).toContainEqual(['gt', 'id', 500]);
    for (const entry of [...trips, ...mockLog.filter((e) => e.table === 'consents')]) {
      expect(entry.calls).toContainEqual(['eq', 'user_id', 'user-1']);
    }
  });

  it('a failed page fails the whole export', async () => {
    mockAnswer.fn = (table) =>
      table === 'consents' ? { data: null, error: { code: '57014' } } : { data: [], error: null };
    await expect(buildExport(user, new AbortController().signal)).rejects.toEqual({
      code: '57014',
    });
  });
});

describe('delete request (ADR-006 section 6)', () => {
  it('reads the status and body of a refusal', async () => {
    const response = new Response(JSON.stringify({ error: 'wrong_account' }), { status: 403 });
    mockInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(response) });
    expect(await requestDeletion('token')).toBe('wrongAccount');
    expect(mockInvoke).toHaveBeenCalledWith(
      'delete-account',
      expect.objectContaining({ body: { idToken: 'token' } }),
    );
  });

  it('a body that is not JSON is an error; a lost connection is "no answer"', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response('<html>', { status: 502 })),
    });
    expect(await requestDeletion('token')).toBe('error');
    mockInvoke.mockResolvedValue({ data: null, error: new FunctionsFetchError('offline') });
    expect(await requestDeletion('token')).toBe('noAnswer');
    mockInvoke.mockResolvedValue({ data: { deleted: false }, error: null });
    expect(await requestDeletion('token')).toBe('deleted');
  });
});
