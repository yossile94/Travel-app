/**
 * flight-coverage (sprint 5 coverage gate, ADR-010): a temporary probe that
 * decides whether AeroDataBox has live data for flights from TLV before the
 * tracking is built. pg_cron calls it with the cron secret.
 *   {action:"discover", fromLocal, toLocal}: one FIDS read of TLV departures
 *     (2 units); picks 15 flights and schedules three probes for each.
 *   {action:"tick"}: runs the probes that are due, one a second (the free
 *     plan's rate), and stores the answer.
 * No user data passes through here. The answers are deleted after 7 days
 * (the AeroDataBox cache terms), by the retention job in the migration.
 */
import { createClient } from '@supabase/supabase-js';

import { aeroDataBox, UNITS } from '../_shared/aerodatabox.ts';
import { hasCronSecret } from '../_shared/cronAuth.ts';
import { gateResult, pickFlights, PROBES, retryAt, tlvDate, type GateRow } from './coverage.ts';

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

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const MAX_PER_TICK = 20;
const STALE_MS = 15 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Spends units only within the month's cap (ADR-010); false when it is reached. */
async function spend(units: number): Promise<boolean> {
  const { data, error } = await admin.rpc('spend_provider_units', {
    p_provider: 'aerodatabox',
    p_units: units,
  });
  if (error) {
    console.error('[flight-coverage] budget check failed', error.code);
    return false;
  }
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!(await hasCronSecret(req))) return json(401, { error: 'unauthorized' });
  const provider = aeroDataBox(required('AERODATABOX_RAPIDAPI_KEY'));
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    fromLocal?: string;
    toLocal?: string;
  };

  if (body.action === 'discover') {
    if (!LOCAL.test(body.fromLocal ?? '') || !LOCAL.test(body.toLocal ?? ''))
      return json(400, { error: 'bad_window' });
    if (!(await spend(UNITS.fids))) return json(429, { error: 'budget' });
    const answer = await provider.departures('TLV', body.fromLocal!, body.toLocal!);
    if (!answer.ok) return json(502, { error: 'provider', status: answer.status });
    // The first probe is 150 minutes before departure: later than now.
    const flights = pickFlights(answer.value, new Date(Date.now() + 155 * 60_000));
    const rows = flights.flatMap((f) =>
      PROBES.map((p) => ({
        flight_number: f.number,
        airline: f.airlineIata,
        dep_date_local: tlvDate(f.departure.scheduledUtc!),
        sched_dep_utc: f.departure.scheduledUtc,
        probe_kind: p.kind,
        probe_at: new Date(
          new Date(f.departure.scheduledUtc!).getTime() + p.minutes * 60_000,
        ).toISOString(),
      })),
    );
    const { error } = await admin.from('flight_coverage_probes').upsert(rows, {
      onConflict: 'flight_number,dep_date_local,probe_kind',
      ignoreDuplicates: true,
    });
    if (error) {
      console.error('[flight-coverage] schedule failed', error.code);
      return json(500, { error: 'write_failed' });
    }
    // A summary of what the window held, for reading the gate (public data).
    const byAirline: Record<string, number> = {};
    for (const f of answer.value)
      byAirline[f.airlineIata ?? '?'] = (byAirline[f.airlineIata ?? '?'] ?? 0) + 1;
    const sample = answer.value
      .filter((f) => ['LY', '6H', 'IZ'].includes(f.airlineIata ?? '') || f.number.startsWith('LY'))
      .slice(0, 3);
    return json(200, {
      seen: answer.value.length,
      picked: flights.map((f) => f.number),
      byAirline,
      sample,
    });
  }

  if (body.action === 'tick') {
    const { data: due, error } = await admin
      .from('flight_coverage_probes')
      .select('id, flight_number, dep_date_local, sched_dep_utc, probe_kind, probe_at')
      .is('done_at', null)
      .lte('probe_at', new Date().toISOString())
      .order('probe_at')
      .limit(MAX_PER_TICK);
    if (error) return json(500, { error: 'read_failed' });
    let done = 0;
    for (const probe of due ?? []) {
      // A probe that missed its time (the cron was down) would skew the gate:
      // closed without a call (Dudi, #11).
      if (Date.parse(probe.probe_at) < Date.now() - STALE_MS) {
        await admin
          .from('flight_coverage_probes')
          .update({ done_at: new Date().toISOString() })
          .eq('id', probe.id);
        continue;
      }
      if (done > 0) await sleep(1100);
      if (!(await spend(UNITS.flight))) break;
      const answer = await provider.flightsByNumber(probe.flight_number, probe.dep_date_local);
      // The leg that leaves TLV; the answer may hold several legs.
      const leg = answer.ok ? (answer.value.find((f) => f.departure.iata === 'TLV') ?? null) : null;
      const { error: writeError } = await admin
        .from('flight_coverage_probes')
        .update({ done_at: new Date().toISOString(), http_ok: answer.ok, snapshot: leg })
        .eq('id', probe.id);
      // Stop rather than spend again on a probe that may run twice (Dudi, #5).
      if (writeError) {
        console.error('[flight-coverage] write failed', writeError.code);
        return json(500, { error: 'write_failed', done });
      }
      const again = probe.probe_kind === 'after' && leg ? retryAt(leg, new Date()) : null;
      if (again) {
        await admin.from('flight_coverage_probes').upsert(
          {
            flight_number: probe.flight_number,
            airline: probe.flight_number.slice(0, 2),
            dep_date_local: probe.dep_date_local,
            sched_dep_utc: probe.sched_dep_utc,
            probe_kind: 'retry',
            probe_at: again,
          },
          { onConflict: 'flight_number,dep_date_local,probe_kind', ignoreDuplicates: true },
        );
      }
      done += 1;
    }
    return json(200, { done });
  }

  if (body.action === 'evaluate') {
    const { data, error } = await admin
      .from('flight_coverage_probes')
      .select('flight_number, probe_kind, snapshot');
    if (error) return json(500, { error: 'read_failed' });
    return json(200, gateResult((data ?? []) as GateRow[]));
  }

  return json(400, { error: 'bad_action' });
});
