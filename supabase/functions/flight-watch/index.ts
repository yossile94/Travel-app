/**
 * flight-watch (sprint 5 F-017, ADR-010): pg_cron calls this each minute when
 * a tracked flight is due. One provider call per flight number and date,
 * whoever tracks it; one a second (the free plan's rate); units spent within
 * the cap first. Changes go to flight_events; Push comes in Sprint 6.
 * No user data passes through here: no PNR, no user ids.
 */
import { createClient } from '@supabase/supabase-js';

import { aeroDataBox, UNITS } from '../_shared/aerodatabox.ts';
import { hasCronSecret } from '../_shared/cronAuth.ts';
import {
  backoff,
  detectChanges,
  ERROR_TRIES,
  NOT_FOUND_TRIES,
  pickLeg,
  planAfter,
  type Notified,
} from '../_shared/watch.ts';

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

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** 20 a run fits the 60-second call with one request a second. */
const PER_RUN = 20;
const PAUSED_RETRY_MS = 60 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Watch = {
  id: number;
  flight_number: string;
  dep_date_local: string;
  sched_dep_utc: string | null;
  sched_arr_utc: string | null;
  attempts: number;
  last_notified: Notified | null;
};

type Check = {
  state: 'active' | 'paused' | 'stopped' | 'failed';
  next: string | null;
  attempts: number;
  snapshot?: unknown;
  notified?: Notified;
  landed?: string | null;
  events?: unknown[];
};

async function apply(id: number, c: Check) {
  const { error } = await admin.rpc('apply_flight_check', {
    p_id: id,
    p_state: c.state,
    p_next: c.next,
    p_attempts: c.attempts,
    p_snapshot: c.snapshot ?? null,
    p_notified: c.notified ?? null,
    p_landed: c.landed ?? null,
    p_events: c.events ?? [],
  });
  if (error) console.error('[flight-watch] apply failed', error.code);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!(await hasCronSecret(req))) return json(401, { error: 'unauthorized' });
  const provider = aeroDataBox(required('AERODATABOX_RAPIDAPI_KEY'));

  const { data, error } = await admin.rpc('claim_flight_watches', { p_limit: PER_RUN });
  if (error) {
    console.error('[flight-watch] claim failed', error.code);
    return json(500, { error: 'claim_failed' });
  }
  const watches = (data ?? []) as Watch[];
  let checked = 0;
  let changes = 0;
  for (const w of watches) {
    const now = new Date();
    const { data: allowed } = await admin.rpc('spend_provider_units', {
      p_provider: 'aerodatabox',
      p_units: UNITS.flight,
    });
    if (allowed !== true) {
      // The cap: paused, shown on the card, tried again in an hour (AC-6א).
      await apply(w.id, {
        state: 'paused',
        next: new Date(now.getTime() + PAUSED_RETRY_MS).toISOString(),
        attempts: w.attempts,
      });
      continue;
    }
    if (checked > 0) await sleep(1100);
    checked += 1;
    const answer = await provider.flightsByNumber(w.flight_number, w.dep_date_local);
    if (!answer.ok) {
      const attempts = w.attempts + 1;
      await apply(w.id, {
        state: attempts >= ERROR_TRIES ? 'failed' : 'active',
        next: backoff(w.attempts, now),
        attempts,
      });
      continue;
    }
    const leg = pickLeg(answer.value, w.sched_dep_utc);
    if (!leg) {
      const attempts = w.attempts + 1;
      await apply(w.id, {
        state: attempts >= NOT_FOUND_TRIES ? 'failed' : 'active',
        next: new Date(now.getTime() + 60 * 60_000).toISOString(),
        attempts,
      });
      continue;
    }
    const { events, notified } = detectChanges(w.last_notified, leg, {
      dep: w.sched_dep_utc,
      arr: w.sched_arr_utc,
    });
    const plan = planAfter(leg, now);
    changes += events.length;
    await apply(w.id, {
      state: plan.state,
      next: plan.state === 'active' ? plan.next : null,
      attempts: 0,
      snapshot: leg,
      notified,
      landed: plan.state === 'stopped' ? plan.landedAt : null,
      events,
    });
  }
  return json(200, { claimed: watches.length, checked, changes });
});
