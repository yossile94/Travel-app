/**
 * Flight search for the add-flight form (sprint 5 AC-1, AC-6ב; sprint 15
 * AC-7, AC-8), apart from its I/O so it is tested with fakes. The database
 * decides in one call (begin_flight_lookup): a copy answers for free, or the
 * search takes one of the user's searches and its units, or it is stopped
 * with the reason. Any stop is an answer the form turns into manual entry,
 * never a dead end.
 */
import type { FlightProvider, FlightSnapshot } from '../_shared/aerodatabox.ts';
import { normalizeNumber, UNITS } from '../_shared/aerodatabox.ts';

export const NUMBER = /^[A-Z0-9]{2}[1-9][0-9]{0,3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60_000;

/** begin_flight_lookup's answer; 'error' when the database didn't answer. */
export type Begin =
  | { status: 'go' }
  | { status: 'copy'; from: 'tracked' | 'cache'; legs: FlightSnapshot[] }
  | { status: 'suspended' | 'off' | 'budget' | 'lookups_day' | 'lookups_30d' | 'error' };

export type LookupDeps = {
  provider: FlightProvider;
  begin(userId: string, number: string, date: string, units: number): Promise<Begin>;
  /** Keeps the answer for the next 24 hours; a failure here loses nothing. */
  remember(number: string, date: string, legs: FlightSnapshot[]): Promise<void>;
  now(): Date;
};

export type LookupAnswer =
  | { status: 200; body: { legs: FlightSnapshot[]; from: 'tracked' | 'cache' | 'provider' } }
  | { status: 400; body: { error: 'bad_number' | 'bad_date' } }
  | { status: 403; body: { error: 'suspended' } }
  | { status: 429; body: { error: 'rate_limited'; reason: 'lookups_day' | 'lookups_30d' } }
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

  const begin = await deps.begin(userId, number, date!, UNITS.flight);
  switch (begin.status) {
    case 'copy':
      return { status: 200, body: { legs: begin.legs, from: begin.from } };
    case 'suspended':
      return { status: 403, body: { error: 'suspended' } };
    case 'lookups_day':
    case 'lookups_30d':
      return { status: 429, body: { error: 'rate_limited', reason: begin.status } };
    case 'off':
    case 'budget':
      return { status: 503, body: { error: 'budget' } };
    case 'error':
      // AC-8: the database didn't answer; no quota or budget was spent.
      return { status: 503, body: { error: 'provider' } };
  }

  const answer = await deps.provider.flightsByNumber(number, date!);
  if (!answer.ok) return { status: 503, body: { error: 'provider' } };
  const legs = answer.value.filter((f) => !f.isCargo);
  await deps.remember(number, date!, legs);
  return { status: 200, body: { legs, from: 'provider' } };
}
