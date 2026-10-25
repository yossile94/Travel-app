/**
 * delete-account (sprint 2 AC-15 to AC-18, ADR-006). The signed-in user asks
 * to delete their own account, proving it is them with a fresh Google ID
 * token. Who is deleted comes only from the session in the Authorization
 * header, never from the request body.
 *
 * Responses (JSON):
 *   200 { deleted: true }   deleted now
 *   200 { deleted: false }  no such user any more (a retry after a lost response)
 *   400 { error: 'bad_request' }     no ID token in the body
 *   401 { error: 'unauthorized' }    no session, or the session is gone
 *   403 { error: 'reauth_failed' }   the Google token is invalid, old or not ours
 *   403 { error: 'wrong_account' }   a valid Google token for another account
 *   405 { error: 'method_not_allowed' }
 *   500 { error: 'server_error' }
 */

export interface SessionUser {
  id: string;
  /** The `sub` of each Google identity linked to the user. */
  googleSubs: string[];
}

export interface Deps {
  /** The user behind a Supabase access token, or null if the session is not valid. */
  userFromToken(accessToken: string): Promise<SessionUser | null>;
  /** Throws unless the token is a fresh Google ID token for our app. */
  verifyGoogle(idToken: string): Promise<{ sub: string }>;
  /** Deletes the user in one transaction; false when there was no such user. */
  deleteUser(userId: string): Promise<boolean>;
}

const MAX_ID_TOKEN_LENGTH = 4096;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function idTokenFrom(req: Request): Promise<string | null> {
  try {
    const body = (await req.json()) as { idToken?: unknown } | null;
    const token = body?.idToken;
    return typeof token === 'string' && token.length > 0 && token.length <= MAX_ID_TOKEN_LENGTH
      ? token
      : null;
  } catch {
    return null;
  }
}

/** Logs what failed without any personal data: no ids, tokens or messages from the input. */
function logFailure(step: string, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`[delete-account] ${step} failed`, {
    name,
    code: typeof code === 'string' ? code : undefined,
  });
}

export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const auth = req.headers.get('Authorization') ?? '';
    const accessToken = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    if (!accessToken) return json(401, { error: 'unauthorized' });

    let user: SessionUser | null;
    try {
      user = await deps.userFromToken(accessToken);
    } catch (error) {
      logFailure('session lookup', error);
      return json(500, { error: 'server_error' });
    }
    if (!user) return json(401, { error: 'unauthorized' });

    const idToken = await idTokenFrom(req);
    if (!idToken) return json(400, { error: 'bad_request' });

    let google: { sub: string };
    try {
      google = await deps.verifyGoogle(idToken);
    } catch {
      return json(403, { error: 'reauth_failed' });
    }
    // Another Google account was chosen: never delete on its say-so.
    if (!user.googleSubs.includes(google.sub)) return json(403, { error: 'wrong_account' });

    try {
      const deleted = await deps.deleteUser(user.id);
      return json(200, { deleted });
    } catch (error) {
      logFailure('deletion', error);
      return json(500, { error: 'server_error' });
    }
  };
}
