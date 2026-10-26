/**
 * Flight Watch decisions (sprint 5 F-017, ADR-010), pure so they are tested
 * without a provider or a database:
 *   - what changed against the values last shown as a change (AC-7),
 *   - when to check next and when tracking ends (AC-6, AC-6א).
 */
import type { FlightSnapshot, MovementTimes } from './aerodatabox.ts';

/** The values last shown to users as a change ("last_notified"). */
export type Notified = {
  depTime: string | null;
  arrTime: string | null;
  depGate: string | null;
  arrGate: string | null;
  status: string | null;
};

export type FlightEvent = {
  field: 'dep_time' | 'arr_time' | 'dep_gate' | 'arr_gate' | 'status';
  old: string | null;
  new: string | null;
};

export const MIN_TIME_CHANGE_MS = 15 * 60_000;
/** Statuses that are a change by themselves (AC-7). */
const ALERT_STATUSES = new Set(['Canceled', 'Diverted']);

/** The provider's best time: revised, then predicted, then scheduled. */
export const bestTime = (m: MovementTimes) => m.revisedUtc ?? m.predictedUtc ?? m.scheduledUtc;

/**
 * Compares a provider answer with what users last saw. The first known time
 * is the schedule, so a first estimate is a change only 15 minutes or more
 * away from it; a first gate is an update, a gate-to-gate move is a change.
 */
export function detectChanges(
  last: Notified | null,
  snap: FlightSnapshot,
  sched: { dep: string | null; arr: string | null },
): { events: FlightEvent[]; notified: Notified } {
  const prev: Notified = last ?? {
    depTime: sched.dep ?? snap.departure.scheduledUtc,
    arrTime: sched.arr ?? snap.arrival.scheduledUtc,
    depGate: null,
    arrGate: null,
    status: null,
  };
  const next: Notified = { ...prev };
  const events: FlightEvent[] = [];

  const time = (field: 'dep_time' | 'arr_time', key: 'depTime' | 'arrTime', now: string | null) => {
    if (now === null) return;
    const before = prev[key];
    if (before === null) {
      next[key] = now;
      return;
    }
    if (Math.abs(Date.parse(now) - Date.parse(before)) >= MIN_TIME_CHANGE_MS) {
      events.push({ field, old: before, new: now });
      next[key] = now;
    }
  };
  time('dep_time', 'depTime', bestTime(snap.departure));
  time('arr_time', 'arrTime', bestTime(snap.arrival));

  const gate = (field: 'dep_gate' | 'arr_gate', key: 'depGate' | 'arrGate', now: string | null) => {
    if (now === null || now === prev[key]) return;
    if (prev[key] !== null) events.push({ field, old: prev[key], new: now });
    next[key] = now;
  };
  gate('dep_gate', 'depGate', snap.departure.gate);
  gate('arr_gate', 'arrGate', snap.arrival.gate);

  if (snap.status !== prev.status) {
    if (ALERT_STATUSES.has(snap.status)) {
      events.push({ field: 'status', old: prev.status, new: snap.status });
    }
    next.status = snap.status;
  }
  return { events, notified: next };
}

export const CHECK_EVERY_MS = 15 * 60_000;
const EN_ROUTE_EVERY_MS = 60 * 60_000;
const WINDOW_BEFORE_MS = 6 * 60 * 60_000;
const NO_ARRIVAL_END_MS = 24 * 60 * 60_000;

export type Plan =
  { state: 'active'; next: string } | { state: 'stopped'; landedAt: string | null };

/**
 * After a good answer: stop at landing or cancellation, or 24 hours after
 * departure when no arrival is known (Raz, Q3); else every 15 minutes up to
 * departure, then once an hour while flying, and once after the expected
 * arrival. Never before the window that starts 6 hours before departure.
 */
export function planAfter(snap: FlightSnapshot, now: Date): Plan {
  if (snap.status === 'Arrived') {
    return {
      state: 'stopped',
      landedAt: snap.arrival.runwayUtc ?? bestTime(snap.arrival) ?? now.toISOString(),
    };
  }
  if (snap.status === 'Canceled') return { state: 'stopped', landedAt: null };
  const dep = bestTime(snap.departure);
  const arr = bestTime(snap.arrival);
  const end = arr
    ? Date.parse(arr) + 2 * 60 * 60_000
    : dep
      ? Date.parse(dep) + NO_ARRIVAL_END_MS
      : null;
  if (end !== null && now.getTime() > end) return { state: 'stopped', landedAt: null };
  const t = now.getTime();
  if (dep && Date.parse(dep) - WINDOW_BEFORE_MS > t + CHECK_EVERY_MS) {
    return { state: 'active', next: new Date(Date.parse(dep) - WINDOW_BEFORE_MS).toISOString() };
  }
  const flying = ['Departed', 'EnRoute', 'Approaching'].includes(snap.status);
  if (flying && arr) {
    const atArrival = Date.parse(arr) + 5 * 60_000;
    return {
      state: 'active',
      next: new Date(
        Math.max(t + CHECK_EVERY_MS, Math.min(atArrival, t + EN_ROUTE_EVERY_MS)),
      ).toISOString(),
    };
  }
  return { state: 'active', next: new Date(t + CHECK_EVERY_MS).toISOString() };
}

/** No such flight: 3 tries an hour apart, then the failure queue (AC-7). */
export const NOT_FOUND_TRIES = 3;
/** Provider errors: back off 5, 10, 20, 40 minutes, then give up. */
export const ERROR_TRIES = 5;
export const backoff = (attempts: number, now: Date) =>
  new Date(now.getTime() + 5 * 60_000 * 2 ** Math.min(attempts, 4)).toISOString();

/** The leg the users track: the one whose scheduled departure is nearest. */
export function pickLeg(legs: FlightSnapshot[], schedDep: string | null): FlightSnapshot | null {
  if (legs.length === 0) return null;
  if (!schedDep) return legs[0]!;
  const target = Date.parse(schedDep);
  return legs.reduce((best, leg) => {
    const d = (l: FlightSnapshot) => {
      const diff = Math.abs(Date.parse(l.departure.scheduledUtc ?? '') - target);
      return Number.isNaN(diff) ? Infinity : diff;
    };
    return d(leg) < d(best) ? leg : best;
  });
}
