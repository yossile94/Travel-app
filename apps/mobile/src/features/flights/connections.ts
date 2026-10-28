/**
 * Connections (sprint 7 F-019, ADR-012): worked out from the trip's flights,
 * never stored. The same rule runs in the database for the at-risk alert;
 * both are tested against supabase/tests/fixtures/connection_cases.json.
 */
import { flightTrackState, liveTime, ownWatch, type Flight } from './flightModel';

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
/** "Short" up to the minimum and 30 minutes more (AC-2). The minimum itself comes from the server. */
export const SHORT_MARGIN_MINUTES = 30;

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

/**
 * Design 2.1: the card's items in departure order; a route (two legs or more)
 * takes the place of its first leg, its legs in a row.
 */
export type CardItem =
  { kind: 'flight'; flight: Flight } | { kind: 'route'; legs: Flight[]; links: Connection[] };

export function routes(sorted: Flight[]): CardItem[] {
  const links = connections(sorted);
  const nextOf = new Map(links.map((c) => [c.prevId, c]));
  const hasPrev = new Set(links.map((c) => c.nextId));
  const byId = new Map(sorted.map((f) => [f.id, f]));
  const out: CardItem[] = [];
  for (const f of sorted) {
    if (hasPrev.has(f.id)) continue;
    if (!nextOf.has(f.id)) {
      out.push({ kind: 'flight', flight: f });
      continue;
    }
    const legs = [f];
    const chain: Connection[] = [];
    for (let c = nextOf.get(f.id); c; c = nextOf.get(c.nextId)) {
      chain.push(c);
      legs.push(byId.get(c.nextId)!);
    }
    out.push({ kind: 'route', legs, links: chain });
  }
  return out;
}

export type LayoverStatus = 'ok' | 'short' | 'risky' | 'missed' | 'invalid' | 'no_mct';

export interface Layover {
  /** Whole minutes on the ground, live where tracked, else as scheduled; null: no times. */
  minutes: number | null;
  /** The arrival airport's minimum, from the server; null in a copy from before sprint 7. */
  mct: number | null;
  status: LayoverStatus;
}

const gone = (f: Flight, now: Date) => {
  const s = flightTrackState(f, now);
  return s === 'cancelled' || s === 'diverted';
};

/**
 * Design 3.2: invalid when a leg is cancelled or diverted; missed at 0 or
 * less; risky under the minimum; short up to 30 minutes over it; else ok.
 * No minimum from the server: no status (the client sets no default).
 */
export function layover(prev: Flight, next: Flight, now: Date): Layover {
  const mct = prev.arrMct ?? null;
  const landed = liveTime(ownWatch(prev)?.snapshot?.arrival) ?? prev.arrSched;
  const leaves = liveTime(ownWatch(next)?.snapshot?.departure) ?? next.depSched;
  // floor, as the server's alert does: the two never disagree at a threshold (Raz design 4).
  const minutes =
    landed && leaves ? Math.floor((Date.parse(leaves) - Date.parse(landed)) / 60_000) : null;
  if (gone(prev, now) || gone(next, now)) return { minutes, mct, status: 'invalid' };
  if (minutes !== null && minutes <= 0) return { minutes, mct, status: 'missed' };
  if (minutes === null || mct === null) return { minutes, mct, status: 'no_mct' };
  if (minutes < mct) return { minutes, mct, status: 'risky' };
  if (minutes < mct + SHORT_MARGIN_MINUTES) return { minutes, mct, status: 'short' };
  return { minutes, mct, status: 'ok' };
}

/** AC-3: the answer holds only while it is about the leg now before (design 3.6). */
export function sameBooking(next: Flight, prevId: string): boolean | null {
  return next.sameBookingPrev === prevId ? (next.sameBooking ?? null) : null;
}
