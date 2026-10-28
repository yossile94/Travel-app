/**
 * One flight-watch run (sprint 5 F-017, sprint 6 F-018; ADR-010, ADR-011),
 * with every outside thing injected (Raz 4) so a test drives it with a fake
 * provider, database, sender and clock:
 *   1. check the flights that are due, within the unit cap and a time budget;
 *   2. send what changed: claimed from the outbox, one alert per flight and
 *      device, a watch at a time: its recipients read in pages, its changes
 *      marked sent right after Expo answers; what the run can't reach is
 *      released for the next one (Dudi 1-3).
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
  /** One watch's recipients after a token id, at most `limit`. */
  targets(watchId: number, afterTokenId: number, limit: number): Promise<Target[]>;
  /** Throws when the server can't take it: a run never goes on unmarked. */
  markSent(eventIds: number[], receipts: { ticket: string; tokenId: number }[]): Promise<void>;
  release(eventIds: number[]): Promise<void>;
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
/** Recipients read per page: under PostgREST's max_rows (1000). */
export const TARGETS_PAGE = 500;
/** Messages a run sends at most; the rest wait for the next run (Dudi 3). */
const MAX_MESSAGES = 5000;
/** Expo batches in flight at once. */
const PARALLEL = 4;
const RECEIPTS_PAGE = 1000;

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

/**
 * Sends with one retry, only on a rate limit or a server error (Raz 12). Not
 * after a timeout: Expo may have taken the batch, and a retry sends it twice.
 */
async function sendOnce(deps: Deps, batch: Parameters<PushSender['send']>[0]) {
  const first = await deps.push.send(batch);
  if (first.ok || !(first.status === 429 || first.status >= 500)) return first;
  await deps.sleep(2000);
  return deps.push.send(batch);
}

/** `started`: the run's start, so the checks and the sends share one time budget (Raz re-review 4). */
export async function sendAlerts(
  deps: Deps,
  started = deps.now().getTime(),
): Promise<{ sent: number }> {
  const { db } = deps;
  const events = await db.claimNotifications(500);
  if (events.length === 0) return { sent: 0 };
  const byWatch = new Map<number, ChangeEvent[]>();
  for (const e of events) byWatch.set(e.watch_id, [...(byWatch.get(e.watch_id) ?? []), e]);
  let sent = 0;
  let messages = 0;
  const dead: number[] = [];
  const left = [...byWatch];
  try {
    while (left.length > 0) {
      if (deps.now().getTime() - started > RUN_BUDGET_MS || messages >= MAX_MESSAGES) break;
      const [watchId, list] = left.shift()!;
      sent += await sendWatch(deps, list, watchId, dead, (n) => (messages += n));
    }
  } finally {
    // Whatever stopped the run, the rest goes back and dead devices go (Dudi re-review 1).
    if (left.length > 0) await db.release(left.flatMap(([, list]) => list.map((e) => e.id)));
    if (dead.length) await db.deleteTokens(dead);
  }
  return { sent };
}

/** One watch's alerts: every page of recipients, then its changes marked or released. */
async function sendWatch(
  deps: Deps,
  list: ChangeEvent[],
  watchId: number,
  dead: number[],
  count: (n: number) => void,
): Promise<number> {
  const { db } = deps;
  const receipts: { ticket: string; tokenId: number }[] = [];
  const ids = list.map((e) => e.id);
  let failed = false;
  let after = 0;
  try {
    for (;;) {
      const page = await db.targets(watchId, after, TARGETS_PAGE);
      const out = buildMessages(list, page);
      count(out.length);
      for (let i = 0; i < out.length && !failed; i += PUSH_BATCH * PARALLEL) {
        const batches: (typeof out)[] = [];
        for (let j = i; j < Math.min(out.length, i + PUSH_BATCH * PARALLEL); j += PUSH_BATCH) {
          batches.push(out.slice(j, j + PUSH_BATCH));
        }
        const results = await Promise.all(
          batches.map((batch) =>
            sendOnce(
              deps,
              batch.map((m) => m.message),
            ),
          ),
        );
        results.forEach((result, k) => {
          if (!result.ok) {
            failed = true;
            deps.log('[flight-watch] push failed', String(result.status));
            return;
          }
          result.tickets.forEach((ticket, j) => {
            const tokenId = batches[k]![j]!.tokenId;
            if (ticket.status === 'ok') receipts.push({ ticket: ticket.id, tokenId });
            else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(tokenId);
            else deps.log('[flight-watch] push ticket error', ticket.details?.error ?? 'unknown');
          });
        });
      }
      if (failed || page.length < TARGETS_PAGE) break;
      after = page[page.length - 1]!.token_id;
    }
  } catch (error) {
    // A later page failed to read: what went is marked, else it is released; the run stops.
    if (receipts.length > 0) await db.markSent(ids, receipts);
    else await db.release(ids);
    throw error;
  }
  if (failed && receipts.length === 0) {
    // Nothing went: the next run sends it, a minute from now, not ten.
    await db.release(ids);
    return 0;
  }
  // Sent (to some devices at least): marked now, so a later failure never sends it twice.
  await db.markSent(ids, receipts);
  return receipts.length;
}

/** Expo's receipts, 15 minutes or more after sending (AC-2): dead devices go. */
export async function readReceipts(deps: Deps): Promise<{ read: number; dropped: number }> {
  const { db } = deps;
  const started = deps.now().getTime();
  let read = 0;
  let dropped = 0;
  // Page after page, oldest first, until the queue is empty or the time is up (Dudi 5).
  for (;;) {
    const pending = await db.oldReceipts(RECEIPTS_PAGE);
    if (pending.length === 0) break;
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
    read += done.length;
    dropped += dead.length;
    // A short page, or Expo not ready with this page: the next run reads on.
    if (pending.length < RECEIPTS_PAGE || done.length === 0) break;
    if (deps.now().getTime() - started > RUN_BUDGET_MS) break;
  }
  return { read, dropped };
}
