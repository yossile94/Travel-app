/**
 * v0.14.1 (Dana 1, Raz 5): a read that never got an answer is "offline", so the
 * screens show the encrypted device copy instead of an error. That covers a
 * Wi-Fi with no internet (NetInfo still says connected), a request that hangs,
 * and a server that doesn't answer (a paused project, a gateway error).
 */

/** Database requests (PostgREST and RPC) give up after this; auth and functions keep their own. */
export const DB_TIMEOUT_MS = 20_000;

/** HTTP answers that mean the server wasn't reached, not that the request was wrong. */
const UNREACHED = new Set([0, 502, 503, 504, 520, 521, 522, 523, 524, 540]);

export function isNetworkError(error: unknown, status?: number): boolean {
  if (status !== undefined && UNREACHED.has(status)) return true;
  if (!error) return false;
  const e = error as { name?: string; message?: string; details?: string };
  const text = `${e.name ?? ''} ${e.message ?? ''} ${e.details ?? ''}`;
  return /network request failed|failed to fetch|aborterror|aborted|timed? ?out/i.test(text);
}

/**
 * The client's fetch: a database request without a signal of its own is
 * aborted after DB_TIMEOUT_MS. Sign-in, token refresh and functions are left
 * as they are, so a slow network never signs anyone out.
 */
export function fetchWithTimeout(base: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (init?.signal || !url.includes('/rest/v1/')) return base(input, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DB_TIMEOUT_MS);
    return base(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}
