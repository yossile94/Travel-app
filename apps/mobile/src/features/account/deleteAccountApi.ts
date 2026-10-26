/**
 * The call to the delete-account Edge Function (sprint 2 AC-15 to AC-18,
 * ADR-006 section 6). Only a 200 means deleted; every other answer leaves the
 * account in place, so the device is never wiped because of an error.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { timing } from '@/theme/tokens';

export type DeleteAnswer =
  /** 200: deleted now, or already gone (a retry after a lost answer, AC-16). */
  | 'deleted'
  /** 401: no valid session. Never "deleted". */
  | 'unauthorized'
  /** 403 reauth_failed: the Google token is bad or outside the server's window (ADR-006 6). */
  | 'reauthFailed'
  /** 403 wrong_account: a valid token for another Google account (AC-18). */
  | 'wrongAccount'
  /** 503: Google's keys are unavailable. */
  | 'unavailable'
  /** No answer in time, or the connection dropped after sending: it may have happened. */
  | 'noAnswer'
  /** 500, 400, 413 or anything outside the contract. */
  | 'error';

/** Maps a response to the contract; exported for tests. */
export function answerFrom(status: number, body: unknown): DeleteAnswer {
  const fields = (body ?? {}) as { deleted?: unknown; error?: unknown };
  if (status === 200) return typeof fields.deleted === 'boolean' ? 'deleted' : 'error';
  if (status === 401) return 'unauthorized';
  if (status === 403 && fields.error === 'wrong_account') return 'wrongAccount';
  if (status === 403 && fields.error === 'reauth_failed') return 'reauthFailed';
  if (status === 503) return 'unavailable';
  return 'error';
}

export async function requestDeletion(idToken: string): Promise<DeleteAnswer> {
  if (!supabase) return 'error';
  const call = supabase.functions
    .invoke('delete-account', { body: { idToken }, timeout: timing.accountDeleteTimeout })
    .then(async ({ data, error }): Promise<DeleteAnswer> => {
      if (!error) return answerFrom(200, data);
      if (error instanceof FunctionsHttpError) {
        const response = error.context as Response;
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          // A body outside the contract counts as an error.
        }
        return answerFrom(response.status, body);
      }
      // FunctionsFetchError / FunctionsRelayError: sent, but no answer.
      console.error('[account] delete request got no answer', error.name);
      return 'noAnswer';
    })
    .catch((): DeleteAnswer => 'noAnswer');
  const timeout = new Promise<DeleteAnswer>((resolve) =>
    setTimeout(() => resolve('noAnswer'), timing.accountDeleteTimeout + 1000),
  );
  return Promise.race([call, timeout]);
}
