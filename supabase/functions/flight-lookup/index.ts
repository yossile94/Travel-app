/**
 * flight-lookup (sprint 5 F-016, AC-1, AC-6ב): the add-flight form's search.
 * Signed-in users only (verify_jwt, and the user is read from the token);
 * 10 searches a day each; units spent within the cap. Nothing personal is
 * logged or sent to the provider: only the flight number and date.
 */
import { createClient } from '@supabase/supabase-js';

import { aeroDataBox, type FlightSnapshot } from '../_shared/aerodatabox.ts';
import { lookup } from './lookup.ts';

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

  const body = (await req.json().catch(() => ({}))) as { number?: unknown; date?: unknown };
  const answer = await lookup(
    {
      provider: aeroDataBox(required('AERODATABOX_RAPIDAPI_KEY')),
      async tracked(number, date) {
        const { data } = await admin
          .from('flight_watch')
          .select('last_snapshot, last_checked_at')
          .eq('flight_number', number)
          .eq('dep_date_local', date)
          .maybeSingle();
        return data?.last_snapshot && data.last_checked_at
          ? { snapshot: data.last_snapshot as FlightSnapshot, checkedAt: data.last_checked_at }
          : null;
      },
      async takeSearch(userId) {
        const { data, error } = await admin.rpc('take_flight_lookup', { p_user: userId });
        if (error) console.error('[flight-lookup] quota failed', error.code);
        return data === true;
      },
      async spend(units) {
        const { data, error } = await admin.rpc('spend_provider_units', {
          p_provider: 'aerodatabox',
          p_units: units,
        });
        if (error) console.error('[flight-lookup] budget failed', error.code);
        return data === true;
      },
      now: () => new Date(),
    },
    auth.user.id,
    body,
  );
  return json(answer.status, answer.body);
});
