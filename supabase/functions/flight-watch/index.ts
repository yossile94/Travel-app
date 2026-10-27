/**
 * flight-watch (sprint 5 F-017, sprint 6 F-018; ADR-010, ADR-011): pg_cron
 * calls this each minute when a tracked flight is due or an alert is unsent,
 * and every 30 minutes for Expo's receipts. The run itself is in run.ts.
 * No user data in logs: no PNR, no user ids, no tokens.
 */
import { createClient } from '@supabase/supabase-js';

import { aeroDataBox } from '../_shared/aerodatabox.ts';
import { hasCronSecret } from '../_shared/cronAuth.ts';
import { expoSender, type ChangeEvent, type Target } from '../_shared/push.ts';
import { checkFlights, readReceipts, sendAlerts, type Deps, type Watch } from './run.ts';

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

const log = (msg: string, code?: string) => console.error(msg, code ?? '');

async function rpc<T>(name: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  const { data, error } = await admin.rpc(name, args);
  if (error) {
    log(`[flight-watch] ${name} failed`, error.code);
    return fallback;
  }
  return (data ?? fallback) as T;
}

function deps(): Deps {
  return {
    provider: aeroDataBox(required('AERODATABOX_RAPIDAPI_KEY')),
    push: expoSender(Deno.env.get('EXPO_ACCESS_TOKEN')),
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log,
    db: {
      claimWatches: (limit) => rpc<Watch[]>('claim_flight_watches', { p_limit: limit }, []),
      spend: async (units) =>
        (await rpc<boolean>(
          'spend_provider_units',
          { p_provider: 'aerodatabox', p_units: units },
          false,
        )) === true,
      apply: (w, c) =>
        rpc<number[]>(
          'apply_flight_check',
          {
            p_id: w.id,
            p_lock: w.locked_until,
            p_state: c.state,
            p_next: c.next,
            p_attempts: c.attempts,
            p_snapshot: c.snapshot ?? null,
            p_notified: c.notified ?? null,
            p_landed: c.landed ?? null,
            p_events: c.events ?? [],
          },
          [],
        ),
      claimNotifications: (limit) =>
        rpc<ChangeEvent[]>('claim_flight_notifications', { p_limit: limit }, []),
      targets: (ids) => rpc<Target[]>('flight_notification_targets', { p_watch_ids: ids }, []),
      markSent: async (ids, receipts) => {
        await rpc('mark_flight_notifications', { p_ids: ids, p_receipts: receipts }, null);
      },
      deleteTokens: async (ids) => {
        const { error } = await admin.from('push_tokens').delete().in('id', ids);
        if (error) log('[flight-watch] token delete failed', error.code);
      },
      oldReceipts: async (limit) => {
        const { data } = await admin
          .from('push_receipts')
          .select('ticket_id, token_id')
          .lt('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
          .limit(limit);
        return (data ?? []) as { ticket_id: string; token_id: number }[];
      },
      dropReceipts: async (ids) => {
        if (ids.length) await admin.from('push_receipts').delete().in('ticket_id', ids);
      },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!(await hasCronSecret(req))) return json(401, { error: 'unauthorized' });
  const body = (await req.json().catch(() => ({}))) as { task?: string };
  const d = deps();
  if (body.task === 'receipts') return json(200, await readReceipts(d));
  const checks = await checkFlights(d);
  const alerts = await sendAlerts(d);
  return json(200, { ...checks, ...alerts });
});
