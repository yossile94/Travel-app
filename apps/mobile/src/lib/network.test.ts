// v0.14.1 (Dana 1, Raz 5): no answer from the server is "offline" (the device
// copy shows), and a database request gives up after 20s.
import { DB_TIMEOUT_MS, fetchWithTimeout, isNetworkError } from './network';

describe('isNetworkError', () => {
  it('a request that never reached the server', () => {
    expect(isNetworkError({ message: 'TypeError: Network request failed' })).toBe(true);
    expect(isNetworkError({ message: 'Failed to fetch' })).toBe(true);
    expect(isNetworkError({ name: 'AbortError', message: 'Aborted' })).toBe(true);
    expect(isNetworkError(null, 0)).toBe(true);
    // A paused project or a gateway in the way.
    expect(isNetworkError({ message: '' }, 540)).toBe(true);
    expect(isNetworkError({ message: '' }, 503)).toBe(true);
  });

  it('an answer that says the request was wrong is a real error', () => {
    expect(
      isNetworkError({ message: 'permission denied for table trips', code: '42501' }, 403),
    ).toBe(false);
    expect(isNetworkError({ message: 'duplicate key' }, 409)).toBe(false);
    expect(isNetworkError(null, 200)).toBe(false);
  });
});

describe('fetchWithTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const hanging = () =>
    jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
          );
        }),
    );

  it('aborts a database request after DB_TIMEOUT_MS', async () => {
    const base = hanging();
    const result = fetchWithTimeout(base as typeof fetch)('https://x.supabase.co/rest/v1/trips');
    const outcome = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await jest.advanceTimersByTimeAsync(DB_TIMEOUT_MS);
    await outcome;
  });

  it('leaves sign-in and functions alone, and a request that brings its own signal', async () => {
    const base = jest.fn(async () => new Response('{}'));
    const wrapped = fetchWithTimeout(base as typeof fetch);
    await wrapped('https://x.supabase.co/auth/v1/token?grant_type=id_token', {});
    await wrapped('https://x.supabase.co/functions/v1/flight-lookup', {});
    const own = new AbortController();
    await wrapped('https://x.supabase.co/rest/v1/trips', { signal: own.signal });
    expect(base.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      {},
      {},
      { signal: own.signal },
    ]);
  });
});
