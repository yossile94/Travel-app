/**
 * delete-account (sprint 2 AC-15 to AC-18, ADR-006). The signed-in user asks
 * to delete their own account, proving it is them with a fresh Google ID
 * token. Who is deleted comes only from the session in the Authorization
 * header, never from the request body.
 *
 * Responses (JSON):
 *   200 { deleted: true }   deleted now
 *   200 { deleted: false }  the account no longer exists (a retry after a lost response)
 *   400 { error: 'bad_request' }     no ID token in the body
 *   401 { error: 'unauthorized' }    no session, or a session that isn't valid
 *   403 { error: 'reauth_failed' }   the Google token is invalid, old or not ours
 *   403 { error: 'wrong_account' }   a valid Google token for another account
 *   405 { error: 'method_not_allowed' }
 *   413 { error: 'too_large' }
 *   500 { error: 'server_error' }    Auth or the database failed; nothing was deleted
 *   503 { error: 'unavailable' }     Google's keys couldn't be fetched; nothing was deleted
 *
 * Only 200 means the account is gone. Every error leaves it in place, so the
 * app never wipes the device on an error it can't tell apart from success.
 */

export interface SessionUser {
  id: string;
  /** The `sub` of each Google identity linked to the user. */
  googleSubs: string[];
}

/**
 * The user behind a session; 'invalid' for a token or session that isn't
 * valid; 'gone' for a valid token whose user no longer exists. Throws when
 * Auth itself fails.
 */
export type SessionLookup = SessionUser | 'invalid' | 'gone';

export interface Deps {
  userFromToken(accessToken: string): Promise<SessionLookup>;
  /** Throws unless the token is a fresh Google ID token for our app. */
  verifyGoogle(idToken: string): Promise<{ sub: string }>;
  /** Deletes the user in one transaction; false when there was no such user. */
  deleteUser(userId: string): Promise<boolean>;
}

const MAX_ID_TOKEN_LENGTH = 4096;
const MAX_BODY_BYTES = 8 * 1024;

/**
 * jose's codes for Google's keys being unreachable or unusable (a non-200
 * answer is ERR_JOSE_GENERIC), as opposed to a token that isn't acceptable.
 */
const UNREACHABLE_GOOGLE_CODES = new Set([
  'ERR_JWKS_TIMEOUT',
  'ERR_JWKS_INVALID',
  'ERR_JOSE_GENERIC',
]);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Three base64url parts: anything else never reaches Auth. */
function looksLikeJwt(token: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
}

/** The body as text, read no further than `limit` bytes (also without a Content-Length). */
async function readCapped(req: Request, limit: number): Promise<string | 'too_large'> {
  if (Number(req.headers.get('Content-Length') ?? 0) > limit) return 'too_large';
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return 'too_large';
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function idTokenFrom(req: Request): Promise<string | null | 'too_large'> {
  try {
    const text = await readCapped(req, MAX_BODY_BYTES);
    if (text === 'too_large') return 'too_large';
    const body = JSON.parse(text) as { idToken?: unknown } | null;
    const token = body?.idToken;
    return typeof token === 'string' && token.length > 0 && token.length <= MAX_ID_TOKEN_LENGTH
      ? token
      : null;
  } catch {
    return null;
  }
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Logs what failed without any personal data: no ids, tokens or messages
 * from the input. jose's claim name ("aud", "iat") shows a misconfigured client id.
 */
function logFailure(step: string, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const claim = (error as { claim?: unknown } | null)?.claim;
  console.error(`[delete-account] ${step} failed`, {
    name,
    code: codeOf(error),
    claim: typeof claim === 'string' ? claim : undefined,
  });
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const auth = req.headers.get('Authorization') ?? '';
    const accessToken = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    if (!looksLikeJwt(accessToken)) return json(401, { error: 'unauthorized' });

    let session: SessionLookup;
    try {
      session = await deps.userFromToken(accessToken);
    } catch (error) {
      logFailure('session lookup', error);
      return json(500, { error: 'server_error' });
    }
    if (session === 'invalid') return json(401, { error: 'unauthorized' });
    // A valid token whose user is gone: deleted already, by an earlier
    // request whose answer never arrived (AC-16).
    if (session === 'gone') return json(200, { deleted: false });

    const idToken = await idTokenFrom(req);
    if (idToken === 'too_large') return json(413, { error: 'too_large' });
    if (!idToken) return json(400, { error: 'bad_request' });

    let google: { sub: string };
    try {
      google = await deps.verifyGoogle(idToken);
    } catch (error) {
      const code = codeOf(error);
      if (!code?.startsWith('ERR_') || UNREACHABLE_GOOGLE_CODES.has(code)) {
        logFailure('Google keys', error);
        return json(503, { error: 'unavailable' });
      }
      logFailure('Google token', error);
      return json(403, { error: 'reauth_failed' });
    }
    // Another Google account was chosen: never delete on its say-so.
    if (!session.googleSubs.includes(google.sub)) {
      console.warn('[delete-account] refused: another Google account');
      return json(403, { error: 'wrong_account' });
    }

    try {
      const deleted = await deps.deleteUser(session.id);
      return json(200, { deleted });
    } catch (error) {
      logFailure('deletion', error);
      return json(500, { error: 'server_error' });
    }
  };
}
