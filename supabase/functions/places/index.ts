/**
 * places (sprint 14 F-043, AC-4): the hotel form's Google Places search.
 * Signed-in users only (verify_jwt, and the user is read from the token).
 * Each call takes the user's daily count and the project's monthly budget in
 * one database step before Google is asked. Without GOOGLE_PLACES_KEY the
 * answer is "unavailable" and the form stays manual (AC-5). Nothing the user
 * typed is logged.
 */
import { createClient } from '@supabase/supabase-js';

import { googlePlaces, places } from './places.ts';

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  const key = keys ? (JSON.parse(keys) as Record<string, string>).default : undefined;
  return key ?? required('SUPABASE_SERVICE_ROLE_KEY');
}

const admin = createClient(required('SUPABASE_URL'), secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json(401, { error: 'unauthorized' });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const key = Deno.env.get('GOOGLE_PLACES_KEY');
  const answer = await places(
    {
      provider: key ? googlePlaces(key) : null,
      async take(userId, kind) {
        const { data, error } = await admin.rpc('take_places_call', {
          p_user: userId,
          p_kind: kind,
        });
        if (error) console.error('[places] quota failed', error.code);
        return data === true;
      },
      now: () => new Date(),
    },
    auth.user.id,
    body && typeof body === 'object' ? body : {},
  );
  return json(answer.status, answer.body);
});
