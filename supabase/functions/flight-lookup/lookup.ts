/**
 * Flight search for the add-flight form (sprint 5 AC-1, AC-6ב), apart from
 * its I/O so it is tested with fakes. A flight already tracked and checked in
 * the last 30 minutes answers from our copy, free; otherwise one of the
 * user's 10 daily searches and 2 provider units are spent. Any failure is an
 * answer the form turns into manual entry, never a dead end.
 */
import type { FlightProvider, FlightSnapshot } from '../_shared/aerodatabox.ts';
import { normalizeNumber, UNITS } from '../_shared/aerodatabox.ts';

export const NUMBER = /^[A-Z0-9]{2}[1-9][0-9]{0,3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FRESH_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type LookupDeps = {
  provider: FlightProvider;
  /** A tracked copy of this flight and when it was checked, if any. */
  tracked(
    number: string,
    date: string,
  ): Promise<{ snapshot: FlightSnapshot; checkedAt: string } | null>;
  takeSearch(userId: string): Promise<boolean>;
  spend(units: number): Promise<boolean>;
  now(): Date;
};

export type LookupAnswer =
  | { status: 200; body: { legs: FlightSnapshot[]; from: 'tracked' | 'provider' } }
  | { status: 400; body: { error: 'bad_number' | 'bad_date' } }
  | { status: 429; body: { error: 'daily_limit' } }
  | { status: 503; body: { error: 'budget' | 'provider' } };

/** "ly 0081" → "LY81": no space, upper case, no leading zeros (AC-1). */
export function normalizeFlightNumber(input: string): string | null {
  const compact = normalizeNumber(input);
  const m = /^([A-Z0-9]{2})0*([0-9]{1,4}[A-Z]?)$/.exec(compact);
  if (!m) return null;
  const number = `${m[1]}${m[2]}`;
  return NUMBER.test(number) ? number : null;
}

export async function lookup(
  deps: LookupDeps,
  userId: string,
  body: { number?: unknown; date?: unknown },
): Promise<LookupAnswer> {
  const number = typeof body.number === 'string' ? normalizeFlightNumber(body.number) : null;
  if (!number) return { status: 400, body: { error: 'bad_number' } };
  const date = typeof body.date === 'string' && DATE.test(body.date) ? body.date : null;
  const day = date ? Date.parse(`${date}T00:00:00Z`) : NaN;
  const now = deps.now().getTime();
  // From 2 days back (late entry) to 355 days ahead (AC-1).
  if (Number.isNaN(day) || day < now - 2 * DAY_MS || day > now + 355 * DAY_MS) {
    return { status: 400, body: { error: 'bad_date' } };
  }

  const copy = await deps.tracked(number, date!);
  if (copy && now - Date.parse(copy.checkedAt) < FRESH_MS) {
    return { status: 200, body: { legs: [copy.snapshot], from: 'tracked' } };
  }
  if (!(await deps.takeSearch(userId))) return { status: 429, body: { error: 'daily_limit' } };
  if (!(await deps.spend(UNITS.flight))) return { status: 503, body: { error: 'budget' } };
  const answer = await deps.provider.flightsByNumber(number, date!);
  if (!answer.ok) return { status: 503, body: { error: 'provider' } };
  const legs = answer.value.filter((f) => !f.isCargo);
  return { status: 200, body: { legs, from: 'provider' } };
}
