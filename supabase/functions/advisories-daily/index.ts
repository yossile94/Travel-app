/**
 * advisories-daily (sprint 4 F-013, ADR-008): once a day, pg_cron calls this
 * to read data.gov.il "travelwarnings" and store one advisory per globe area.
 * verify_jwt is off and the call carries no secret: it only refreshes public
 * data, and a run is claimed in the database first (at most one an hour), so
 * a stray call costs a no-op. Entry status (by hand) is never touched here.
 */
import { createClient } from '@supabase/supabase-js';

import { advisoriesFrom, type WarningRecord } from './advisories.ts';

const DATASET =
  'https://data.gov.il/api/3/action/datastore_search?resource_id=2a01d234-b2b0-4d46-baa0-cec05c401e7d&limit=2000';

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // One run an hour at most, claimed atomically (ADR-008): parallel or
  // repeated calls, and calls after a failed run, are no-ops.
  const { data: claimed, error: claimError } = await admin.rpc('claim_job_run', {
    p_name: 'advisories',
  });
  if (claimError) {
    console.error('[advisories-daily] claim failed', claimError.code);
    return json(500, { error: 'claim_failed' });
  }
  if (claimed !== true) return json(200, { skipped: 'recent' });

  let records: WarningRecord[];
  try {
    const response = await fetch(DATASET, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as { success?: boolean; result?: { records?: unknown } };
    if (!body.success || !Array.isArray(body.result?.records)) throw new Error('unexpected shape');
    records = body.result.records as WarningRecord[];
  } catch (error) {
    // No response body in the log.
    console.error('[advisories-daily] fetch failed', (error as Error).message);
    return json(502, { error: 'source_unavailable' });
  }

  const { advisories, unmapped } = advisoriesFrom(records);
  // A near-empty answer is a broken source, not a world without warnings.
  if (advisories.length < 100) {
    console.error('[advisories-daily] too few areas', advisories.length);
    return json(502, { error: 'source_incomplete' });
  }
  if (unmapped.length) console.warn('[advisories-daily] names without an area', unmapped);

  const fetchedAt = new Date().toISOString();
  const { error } = await admin.from('country_advisories').upsert(
    advisories.map((a) => ({ ...a, fetched_at: fetchedAt })),
    { onConflict: 'adm0' },
  );
  if (error) {
    console.error('[advisories-daily] write failed', error.code);
    return json(500, { error: 'write_failed' });
  }
  return json(200, { areas: advisories.length, unmapped: unmapped.length });
});
