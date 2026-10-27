/**
 * Connections (sprint 7 F-019, ADR-012): worked out from the trip's flights,
 * never stored. The same rule runs in the database for the at-risk alert;
 * both are tested against supabase/tests/fixtures/connection_cases.json.
 */
import { liveTime, type Flight } from './flightModel';

/** What the rule reads of a flight. */
export type Leg = Pick<
  Flight,
  'id' | 'tripId' | 'direction' | 'depIata' | 'arrIata' | 'depSched' | 'arrSched'
>;

export interface Connection {
  prevId: string;
  nextId: string;
  /** Where the user changes planes. */
  airport: string;
}

const DAY_MS = 24 * 60 * 60_000;
/** The minimum connection time where the airport has none (sprint 7 AC-2; the server's default). */
export const DEFAULT_MCT_MINUTES = 60;
/** "Short" up to the minimum and 30 minutes more (AC-2). */
const SHORT_MARGIN_MINUTES = 30;

const byTimeThenId = (ta: number, tb: number, a: string, b: string) =>
  ta - tb || (a < b ? -1 : a > b ? 1 : 0);

/**
 * AC-1: same trip, same direction, the first one's arrival airport is the
 * second's departure airport, and by the schedule the second leaves after the
 * first lands and within 24 hours. Each landing takes the first departure
 * after it; a flight has one leg before it and one after it at most. No
 * schedule or no arrival airport: no connection.
 */
export function connections(flights: Leg[]): Connection[] {
  const landings = flights
    .filter((f) => f.arrIata && f.arrSched)
    .sort((a, b) => byTimeThenId(Date.parse(a.arrSched!), Date.parse(b.arrSched!), a.id, b.id));
  const taken = new Set<string>();
  const out: Connection[] = [];
  for (const a of landings) {
    const landed = Date.parse(a.arrSched!);
    let best: Leg | null = null;
    for (const b of flights) {
      if (b.id === a.id || taken.has(b.id) || !b.depSched) continue;
      if (b.tripId !== a.tripId || b.direction !== a.direction || b.depIata !== a.arrIata) continue;
      const leaves = Date.parse(b.depSched);
      if (leaves <= landed || leaves - landed > DAY_MS) continue;
      if (!best || byTimeThenId(leaves, Date.parse(best.depSched!), b.id, best.id) < 0) best = b;
    }
    if (best) {
      taken.add(best.id);
      out.push({ prevId: a.id, nextId: best.id, airport: a.arrIata! });
    }
  }
  return out;
}

export type LayoverStatus = 'enough' | 'short' | 'risky' | 'missed' | 'void';

/** The time on the ground, live where tracked, else as scheduled (AC-2). */
export function layoverMinutes(prev: Flight, next: Flight): number | null {
  const landed = liveTime(prev.watch?.snapshot?.arrival) ?? prev.arrSched;
  const leaves = liveTime(next.watch?.snapshot?.departure) ?? next.depSched;
  if (!landed || !leaves) return null;
  return Math.round((Date.parse(leaves) - Date.parse(landed)) / 60_000);
}

const dead = (f: Flight) => ['Canceled', 'Diverted'].includes(f.watch?.snapshot?.status ?? '');

/**
 * AC-2: risky under the minimum, short up to 30 minutes over it, else enough;
 * 0 or less: the next flight may be missed; a cancelled or diverted leg: the
 * connection no longer holds.
 */
export function layoverStatus(
  prev: Flight,
  next: Flight,
  mctMinutes: number = DEFAULT_MCT_MINUTES,
): { status: LayoverStatus; minutes: number | null } {
  if (dead(prev) || dead(next)) return { status: 'void', minutes: null };
  const minutes = layoverMinutes(prev, next);
  if (minutes === null) return { status: 'enough', minutes };
  if (minutes <= 0) return { status: 'missed', minutes };
  if (minutes < mctMinutes) return { status: 'risky', minutes };
  if (minutes < mctMinutes + SHORT_MARGIN_MINUTES) return { status: 'short', minutes };
  return { status: 'enough', minutes };
}
