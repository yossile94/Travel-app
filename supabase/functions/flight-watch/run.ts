/**
 * One flight-watch run (sprint 5 F-017, sprint 6 F-018; ADR-010, ADR-011),
 * with every outside thing injected (Raz 4) so a test drives it with a fake
 * provider, database, sender and clock:
 *   1. check the flights that are due, within the unit cap and a time budget;
 *   2. send what changed: claimed from the outbox, one alert per flight and
 *      user, marked sent only after Expo answers.
 * The "receipts" task reads Expo's receipts and drops dead tokens.
 */
import { UNITS, type FlightProvider } from '../_shared/aerodatabox.ts';
import { buildMessages, type ChangeEvent, type PushSender, type Target } from '../_shared/push.ts';
import {
  backoff,
  detectChanges,
  ERROR_TRIES,
  NOT_FOUND_TRIES,
  pickLeg,
  planAfter,
  type Notified,
} from '../_shared/watch.ts';

export type Watch = {
  id: number;
  flight_number: string;
  dep_date_local: string;
  sched_dep_utc: string | null;
  sched_arr_utc: string | null;
  attempts: number;
  last_notified: Notified | null;
  /** The claim's lock: only this run may apply its check (Dudi #11). */
  locked_until: string;
};

export type Check = {
  state: 'active' | 'paused' | 'stopped' | 'failed';
  next: string | null;
  attempts: number;
  snapshot?: unknown;
  notified?: Notified;
  landed?: string | null;
  events?: unknown[];
};

export type WatchDb = {
  claimWatches(limit: number): Promise<Watch[]>;
  spend(units: number): Promise<boolean>;
  /** The ids of the changes written. */
  apply(w: Watch, c: Check): Promise<number[]>;
  claimNotifications(limit: number): Promise<ChangeEvent[]>;
  targets(watchIds: number[]): Promise<Target[]>;
  markSent(eventIds: number[], receipts: { ticket: string; tokenId: number }[]): Promise<void>;
  deleteTokens(tokenIds: number[]): Promise<void>;
  oldReceipts(limit: number): Promise<{ ticket_id: string; token_id: number }[]>;
  dropReceipts(ticketIds: string[]): Promise<void>;
};

export type Deps = {
  db: WatchDb;
  provider: FlightProvider;
  push: PushSender;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string, code?: string) => void;
};

/** 20 a run fits the 60-second call with one request a second. */
const PER_RUN = 20;
const PAUSED_RETRY_MS = 60 * 60_000;
/** Under the function's limit and the 5-minute claim (Raz 8). */
const RUN_BUDGET_MS = 45_000;
const DAY_MS = 24 * 60 * 60_000;
const PUSH_BATCH = 100;

export async function checkFlights(deps: Deps): Promise<{ checked: number; changes: number }> {
  const { db, provider } = deps;
  const watches = await db.claimWatches(PER_RUN);
  let checked = 0;
  let changes = 0;
  const started = deps.now().getTime();
  for (const w of watches) {
    if (deps.now().getTime() - started > RUN_BUDGET_MS) break;
    const now = deps.now();
    // Over by its own schedule: stop before spending anything (Raz 9).
    const end = w.sched_arr_utc
      ? Date.parse(w.sched_arr_utc) + DAY_MS
      : w.sched_dep_utc
        ? Date.parse(w.sched_dep_utc) + 2 * DAY_MS
        : null;
    if (end !== null && now.getTime() > end) {
      await db.apply(w, { state: 'stopped', next: null, attempts: w.attempts });
      continue;
    }
    if (!(await db.spend(UNITS.flight))) {
      // The cap: paused, shown on the card, tried again in an hour (AC-6א).
      await db.apply(w, {
        state: 'paused',
        next: new Date(now.getTime() + PAUSED_RETRY_MS).toISOString(),
        attempts: w.attempts,
      });
      continue;
    }
    if (checked > 0) await deps.sleep(1100);
    checked += 1;
    const answer = await provider.flightsByNumber(w.flight_number, w.dep_date_local);
    if (!answer.ok && answer.status === 429) {
      // The provider's rate limit is ours, not the flight's: soon, uncounted.
      await db.apply(w, {
        state: 'active',
        next: new Date(now.getTime() + 5 * 60_000).toISOString(),
        attempts: w.attempts,
      });
      continue;
    }
    if (!answer.ok) {
      const attempts = w.attempts + 1;
      await db.apply(w, {
        state: attempts >= ERROR_TRIES ? 'failed' : 'active',
        next: backoff(w.attempts, now),
        attempts,
      });
      continue;
    }
    const leg = pickLeg(answer.value, w.sched_dep_utc);
    if (!leg) {
      const attempts = w.attempts + 1;
      await db.apply(w, {
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
    const ids = await db.apply(w, {
      state: plan.state,
      next: plan.state === 'active' ? plan.next : null,
      attempts: 0,
      snapshot: leg,
      notified,
      landed: plan.state === 'stopped' ? plan.landedAt : null,
      events,
    });
    changes += ids.length;
  }
  return { checked, changes };
}

/** Sends with one retry, only on a rate limit or a server error (Raz 12). */
async function sendOnce(deps: Deps, batch: Parameters<PushSender['send']>[0]) {
  const first = await deps.push.send(batch);
  if (first.ok || !(first.status === 429 || first.status >= 500 || first.status === 0))
    return first;
  await deps.sleep(2000);
  return deps.push.send(batch);
}

export async function sendAlerts(deps: Deps): Promise<{ sent: number }> {
  const { db } = deps;
  const events = await db.claimNotifications(500);
  if (events.length === 0) return { sent: 0 };
  const targets = await db.targets([...new Set(events.map((e) => e.watch_id))]);
  const messages = buildMessages(events, targets);
  const receipts: { ticket: string; tokenId: number }[] = [];
  const dead: number[] = [];
  for (let i = 0; i < messages.length; i += PUSH_BATCH) {
    const batch = messages.slice(i, i + PUSH_BATCH);
    const result = await sendOnce(
      deps,
      batch.map((m) => m.message),
    );
    if (!result.ok) {
      // Not marked: the claim lapses in 5 minutes and the next run sends them.
      deps.log('[flight-watch] push failed', String(result.status));
      return { sent: receipts.length };
    }
    result.tickets.forEach((ticket, j) => {
      const tokenId = batch[j]!.tokenId;
      if (ticket.status === 'ok') receipts.push({ ticket: ticket.id, tokenId });
      else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(tokenId);
      else deps.log('[flight-watch] push ticket error', ticket.details?.error ?? 'unknown');
    });
  }
  if (dead.length) await db.deleteTokens(dead);
  // Every claimed change is done, those nobody receives (alerts off, no device) included.
  await db.markSent(
    events.map((e) => e.id),
    receipts,
  );
  return { sent: receipts.length };
}

/** Expo's receipts, 15 minutes or more after sending (AC-2): dead devices go. */
export async function readReceipts(deps: Deps): Promise<{ read: number; dropped: number }> {
  const { db } = deps;
  const pending = await db.oldReceipts(1000);
  if (pending.length === 0) return { read: 0, dropped: 0 };
  const answers = await deps.push.receipts(pending.map((r) => r.ticket_id));
  const dead: number[] = [];
  const done: string[] = [];
  for (const r of pending) {
    const a = answers[r.ticket_id];
    if (!a) continue;
    done.push(r.ticket_id);
    if (a.status === 'error') {
      if (a.details?.error === 'DeviceNotRegistered') dead.push(r.token_id);
      else deps.log('[flight-watch] push receipt error', a.details?.error ?? 'unknown');
    }
  }
  if (dead.length) await db.deleteTokens([...new Set(dead)]);
  await db.dropReceipts(done);
  return { read: done.length, dropped: dead.length };
}
