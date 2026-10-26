/**
 * rates-daily (sprint 4 F-012, ADR-008): once a day, pg_cron calls this to
 * store the latest exchange rates: the Bank of Israel, then ExchangeRate-API
 * (free, no key) for the rest. verify_jwt is off and the call carries no
 * secret: it only refreshes public data, and a run within the last hour is
 * skipped. Only the latest rate per currency is kept (ER-API terms).
 */
import { createClient } from '@supabase/supabase-js';

import { ratesFrom, type BoiRate, type ErApiAnswer } from './rates.ts';

const BOI = 'https://boi.org.il/PublicApi/GetExchangeRates';
const ERAPI = 'https://open.er-api.com/v6/latest/USD';
const MIN_INTERVAL_MS = 60 * 60 * 1000;

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

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} status ${response.status}`);
  return (await response.json()) as T;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const { data: last } = await admin
    .from('exchange_rates')
    .select('fetched_at')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last?.fetched_at && Date.now() - Date.parse(last.fetched_at) < MIN_INTERVAL_MS) {
    return json(200, { skipped: 'recent' });
  }

  let rows;
  try {
    const [boi, erapi] = await Promise.all([
      getJson<{ exchangeRates: BoiRate[] }>(BOI),
      getJson<ErApiAnswer>(ERAPI),
    ]);
    rows = ratesFrom(boi.exchangeRates ?? [], erapi);
  } catch (error) {
    // No response bodies in the log.
    console.error('[rates-daily] sources failed', (error as Error).message);
    return json(502, { error: 'source_unavailable' });
  }

  const fetchedAt = new Date().toISOString();
  const { error } = await admin.from('exchange_rates').upsert(
    rows.map((r) => ({ ...r, fetched_at: fetchedAt })),
    { onConflict: 'currency' },
  );
  if (error) {
    console.error('[rates-daily] write failed', error.code);
    return json(500, { error: 'write_failed' });
  }
  return json(200, { currencies: rows.length });
});
