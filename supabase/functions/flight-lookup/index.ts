/**
 * flight-lookup (sprint 5 F-016, AC-1, AC-6ב; sprint 15 AC-7, AC-8): the
 * add-flight form's search. Signed-in users only (verify_jwt, and the user is
 * read from the token). The database decides what a search may do, in one
 * call. Nothing personal is logged or sent to the provider: only the flight
 * number and date, and the copy keeps no user id.
 */
import { createClient } from '@supabase/supabase-js';

import { aeroDataBox, type FlightSnapshot } from '../_shared/aerodatabox.ts';
import { type Begin, lookup } from './lookup.ts';

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

const STOPS = ['go', 'suspended', 'off', 'budget', 'lookups_day', 'lookups_30d'];

/** begin_flight_lookup's jsonb as a Begin; anything else is 'error' (AC-8). */
function beginFrom(data: unknown): Begin {
  const a = (data ?? {}) as { status?: unknown; from?: unknown; legs?: unknown };
  if (
    a.status === 'copy' &&
    (a.from === 'tracked' || a.from === 'cache') &&
    Array.isArray(a.legs)
  ) {
    return { status: 'copy', from: a.from, legs: a.legs as FlightSnapshot[] };
  }
  if (typeof a.status === 'string' && STOPS.includes(a.status))
    return { status: a.status } as Begin;
  return { status: 'error' };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json(401, { error: 'unauthorized' });

  const body = (await req.json().catch(() => ({}))) as { number?: unknown; date?: unknown };
  const answer = await lookup(
    {
      provider: aeroDataBox(required('AERODATABOX_RAPIDAPI_KEY')),
      async begin(userId, number, date, units) {
        const { data, error } = await admin.rpc('begin_flight_lookup', {
          p_user: userId,
          p_number: number,
          p_date: date,
          p_units: units,
        });
        if (error) {
          console.error('[flight-lookup] begin failed', error.code);
          return { status: 'error' };
        }
        const begin = beginFrom(data);
        if (begin.status === 'error')
          console.error('[flight-lookup] begin answered out of contract');
        return begin;
      },
      async remember(number, date, legs) {
        const { error } = await admin.rpc('put_flight_lookup', {
          p_number: number,
          p_date: date,
          p_legs: legs,
        });
        if (error) console.error('[flight-lookup] copy failed', error.code);
      },
      now: () => new Date(),
    },
    auth.user.id,
    body,
  );
  return json(answer.status, answer.body);
});
