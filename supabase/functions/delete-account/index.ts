/**
 * Entry point of the delete-account Edge Function: wires the handler to
 * Supabase Auth, Google's keys and the admin_delete_user SQL function
 * (ADR-006). verify_jwt is off (config.toml): the platform's check only
 * understands the legacy keys, and the handler checks the session itself
 * with auth.getUser, which also confirms it still exists on the server.
 */
import { createClient } from '@supabase/supabase-js';

import { verifyGoogleIdToken } from './google.ts';
import { createHandler } from './handler.ts';

/** A fresh re-authentication: the Google token was issued in the last 5 minutes (AC-18). */
const GOOGLE_TOKEN_MAX_AGE_SECONDS = 5 * 60;

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** The secret key from the environment only: the new keys, or the legacy one locally. */
function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  const key = keys ? (JSON.parse(keys) as Record<string, string>).default : undefined;
  return key ?? required('SUPABASE_SERVICE_ROLE_KEY');
}

const admin = createClient(required('SUPABASE_URL'), secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const audience = required('GOOGLE_WEB_CLIENT_ID');

Deno.serve(
  createHandler({
    async userFromToken(accessToken) {
      const { data, error } = await admin.auth.getUser(accessToken);
      if (error || !data.user) return null;
      const googleSubs = (data.user.identities ?? [])
        .filter((identity) => identity.provider === 'google')
        .map((identity) => {
          const sub = (identity.identity_data as { sub?: unknown } | undefined)?.sub;
          return typeof sub === 'string' ? sub : identity.id;
        });
      return { id: data.user.id, googleSubs };
    },
    verifyGoogle: (idToken) =>
      verifyGoogleIdToken(idToken, { audience, maxAgeSeconds: GOOGLE_TOKEN_MAX_AGE_SECONDS }),
    async deleteUser(userId) {
      const { data, error } = await admin.rpc('admin_delete_user', {
        target: userId,
        why: 'user_request',
      });
      if (error) throw error;
      return data === true;
    },
  }),
);
