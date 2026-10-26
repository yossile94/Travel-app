/**
 * Turns Supabase Auth's answer about an access token into the handler's
 * SessionLookup (ADR-006 section 6). Kept apart from index.ts so it is tested.
 */
import type { SessionLookup, SessionUser } from './handler.ts';

export interface AuthIdentityLike {
  provider: string;
  /** GoTrue's provider id: Google's `sub`. */
  id: string;
  identity_data?: Record<string, unknown> | null;
}

export interface AuthUserLike {
  id: string;
  identities?: AuthIdentityLike[] | null;
}

export interface AuthErrorLike {
  status?: number;
  code?: string;
}

/** The user's id and the `sub` of each of their Google identities (no other provider). */
export function sessionUserFrom(user: AuthUserLike): SessionUser {
  const googleSubs = (user.identities ?? [])
    .filter((identity) => identity.provider === 'google')
    .map((identity) => {
      const sub = identity.identity_data?.sub;
      return typeof sub === 'string' && sub.length > 0 ? sub : identity.id;
    })
    .filter((sub) => typeof sub === 'string' && sub.length > 0);
  return { id: user.id, googleSubs };
}

/** Error codes of a token or session that isn't valid: 401, never "deleted". */
const INVALID_CODES = new Set([
  'bad_jwt',
  'invalid_jwt',
  'no_authorization',
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
]);

/** The slice of supabase-js's rpc this function uses. */
export type Rpc = (
  fn: 'admin_delete_user',
  args: { target: string; why: 'user_request' },
) => PromiseLike<{ data: unknown; error: unknown }>;

/** Deletes through admin_delete_user; true only when the function said so. */
export async function deleteUserWith(rpc: Rpc, userId: string): Promise<boolean> {
  const { data, error } = await rpc('admin_delete_user', { target: userId, why: 'user_request' });
  if (error) throw error;
  return data === true;
}

/**
 * 'gone' only for a validly signed token whose user doesn't exist (GoTrue
 * checks the signature before looking the user up); 'invalid' for a token or
 * session that isn't valid. Anything else (Auth down, timeouts) throws, so
 * the handler answers 500 and the app never wipes the device on it.
 */
export function lookupFrom(user: AuthUserLike | null, error: AuthErrorLike | null): SessionLookup {
  if (!error && user) return sessionUserFrom(user);
  if (error?.code === 'user_not_found') return 'gone';
  if (error && (INVALID_CODES.has(error.code ?? '') || error.status === 401)) return 'invalid';
  throw Object.assign(new Error('Auth lookup failed'), { code: error?.code ?? 'no_user' });
}
