/**
 * Entry point of the delete-account Edge Function: wires the handler to
 * Supabase Auth, Google's keys and the admin_delete_user SQL function
 * (ADR-006 section 6). verify_jwt is off (config.toml): the project signs
 * sessions with asymmetric keys (ES256), which the platform's check doesn't
 * verify; the handler checks the session itself with auth.getUser, which
 * also confirms it still exists on the server.
 */
import { createClient } from '@supabase/supabase-js';

import { GOOGLE_TOKEN_MAX_AGE_SECONDS, verifyGoogleIdToken } from './google.ts';
import { createHandler } from './handler.ts';
import { deleteUserWith, lookupFrom, type Rpc } from './session.ts';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** The secret key from the environment only: the new keys, or the legacy one locally. */
function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  const key = keys ? (JSON.parse(keys) as Record<string, string>).default : undefined;
  // Which source, never the value: a silent fall back to the legacy key shows here.
  console.info(`[delete-account] secret key from ${key ? 'SUPABASE_SECRET_KEYS' : 'legacy'}`);
  return key ?? required('SUPABASE_SERVICE_ROLE_KEY');
}

const admin = createClient(required('SUPABASE_URL'), secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});
/**
 * The app's Google Web client: public (it ships in the app bundle), so it
 * has a default here; GOOGLE_WEB_CLIENT_ID overrides it per environment
 * (production gets its own client).
 */
const DEV_GOOGLE_WEB_CLIENT_ID =
  '263709257260-339uciacknal8tq6s2hbmruqa4i2274c.apps.googleusercontent.com';
const audience = Deno.env.get('GOOGLE_WEB_CLIENT_ID') ?? DEV_GOOGLE_WEB_CLIENT_ID;

Deno.serve(
  createHandler({
    async userFromToken(accessToken) {
      const { data, error } = await admin.auth.getUser(accessToken);
      return lookupFrom(data.user, error);
    },
    verifyGoogle: (idToken) =>
      verifyGoogleIdToken(idToken, { audience, maxAgeSeconds: GOOGLE_TOKEN_MAX_AGE_SECONDS }),
    deleteUser: (userId) => deleteUserWith(admin.rpc.bind(admin) as unknown as Rpc, userId),
  }),
);
