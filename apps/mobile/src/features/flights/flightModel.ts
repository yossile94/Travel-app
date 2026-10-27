/**
 * A trip's flights as the app holds them (sprint 5 F-016, F-017), and the
 * pure rules the card, the sheet and the form share: the flight number
 * (design 2.1), the tracking state (design 11) and the status tags (9.4).
 */

export type Direction = 'out' | 'return' | 'internal';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';

/** The provider's view of one side, as the tracking stored it. */
export interface MovementSnapshot {
  iata: string | null;
  timeZone: string | null;
  scheduledUtc: string | null;
  revisedUtc: string | null;
  predictedUtc: string | null;
  runwayUtc: string | null;
  terminal: string | null;
  gate: string | null;
}

export interface FlightSnapshot {
  number: string;
  airlineIata: string | null;
  airlineName?: string | null;
  status: string;
  departure: MovementSnapshot;
  arrival: MovementSnapshot;
}

export type EventField = 'dep_time' | 'arr_time' | 'dep_gate' | 'arr_gate' | 'status';

export interface FlightEvent {
  id: number;
  field: EventField;
  old: string | null;
  new: string | null;
  at: string;
}

export interface FlightWatch {
  state: 'active' | 'paused' | 'stopped' | 'failed';
  checkedAt: string | null;
  snapshot: FlightSnapshot | null;
  landedAt: string | null;
  events: FlightEvent[];
}

/** What the user saved: their values, never overwritten by the tracking. */
export interface Flight {
  id: string;
  tripId: string;
  direction: Direction;
  numberInput: string;
  number: string;
  depDateLocal: string;
  airline: string | null;
  depIata: string;
  depTz: string;
  depCountry: string | null;
  arrIata: string | null;
  arrTz: string | null;
  arrCountry: string | null;
  depSched: string | null;
  arrSched: string | null;
  depTerminal: string | null;
  depGate: string | null;
  arrTerminal: string | null;
  arrGate: string | null;
  pnr: string | null;
  seat: string | null;
  cabin: Cabin | null;
  /** Null: never tracked (a past flight), or tracking over and its data deleted. */
  watch: FlightWatch | null;
}

export const FLIGHTS_PER_TRIP = 20;
export const DAYS_AHEAD = 355;

/**
 * "ly 081" → "LY81" (design 2.1): no spaces or dashes, upper case, no leading
 * zeros. Two characters of airline code with at least one letter, then 1–4
 * digits. Null when it can't be a flight number.
 */
export function normalizeFlightNumber(input: string): string | null {
  const compact = input.replace(/[\s-]+/g, '').toUpperCase();
  const m = /^([A-Z0-9]{2})(\d{1,4})$/.exec(compact);
  if (!m || !/[A-Z]/.test(m[1]!)) return null;
  const digits = m[2]!.replace(/^0+/, '');
  return digits ? `${m[1]}${digits}` : null;
}

/** While typing: upper case, spaces and dashes dropped (design 2.1). */
export const typingFlightNumber = (input: string) =>
  input
    .replace(/[\s-]+/g, '')
    .toUpperCase()
    .slice(0, 8);

/** While typing a booking code: A-Z and 0-9 only (design 7.1). */
export const typingCode = (input: string, max: number) =>
  input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, max);

export const PNR = /^[A-Z0-9]{5,8}$/;
export const SEAT = /^[A-Z0-9]{1,4}$/;

export type TrackState =
  | 'untracked_past'
  | 'not_checked'
  | 'tracking'
  | 'paused'
  | 'not_found'
  | 'landed'
  | 'cancelled'
  | 'diverted'
  | 'ended';

const DAY = 24 * 60 * 60_000;

/**
 * The tracking as this flight may use it: a snapshot of another leg of the same
 * number (a multi-leg flight, Raz 3) is not this flight's, so it is dropped.
 */
export function ownWatch(flight: Flight): FlightWatch | null {
  const w = flight.watch;
  const iata = w?.snapshot?.departure.iata;
  if (!w || !iata || iata === flight.depIata) return w;
  return { ...w, snapshot: null, checkedAt: null, events: [] };
}

/** One state for the card and the sheet (design 11). */
export function flightTrackState(flight: Flight, now: Date): TrackState {
  const w = flight.watch;
  if (!w) {
    // No watch: never tracked because it had left, or its data was deleted.
    const end = flight.arrSched ?? flight.depSched;
    const over = end ? Date.parse(end) + DAY < now.getTime() : false;
    return over ? 'ended' : 'untracked_past';
  }
  if (w.state === 'failed') return 'not_found';
  const status = w.snapshot?.status;
  if (status === 'Canceled') return 'cancelled';
  if (status === 'Diverted') return 'diverted';
  if (status === 'Arrived' || w.landedAt) return 'landed';
  if (w.state === 'paused') return 'paused';
  if (!w.checkedAt) return w.state === 'stopped' ? 'ended' : 'not_checked';
  return w.state === 'stopped' ? 'ended' : 'tracking';
}

/** The provider's best time for a side: actual, then revised, then predicted. */
export const liveTime = (m: MovementSnapshot | undefined) =>
  m ? (m.runwayUtc ?? m.revisedUtc ?? m.predictedUtc) : null;

export type ChipKind =
  | 'on-time'
  | 'delayed'
  | 'earlier'
  | 'gate-changed'
  | 'cancelled'
  | 'diverted'
  | 'departed'
  | 'landed'
  | 'paused'
  | 'untracked';

const CHANGE_MS = 15 * 60_000;

/** Up to two tags, in the design's order (9.4). */
export function flightChips(flight: Flight, state: TrackState): ChipKind[] {
  if (state === 'cancelled') return ['cancelled'];
  if (state === 'diverted') return ['diverted'];
  if (state === 'paused') return ['paused'];
  if (state === 'untracked_past') return ['untracked'];
  if (state === 'not_checked' || state === 'not_found' || state === 'ended') return [];
  const snap = flight.watch?.snapshot;
  const chips: ChipKind[] = [];
  const sched = flight.watch?.snapshot?.departure.scheduledUtc ?? flight.depSched;
  const dep = liveTime(snap?.departure);
  if (sched && dep) {
    const diff = Date.parse(dep) - Date.parse(sched);
    if (diff >= CHANGE_MS) chips.push('delayed');
    else if (diff <= -CHANGE_MS) chips.push('earlier');
  }
  if (flight.watch?.events.some((e) => e.field === 'dep_gate')) chips.push('gate-changed');
  if (chips.length === 0) {
    if (state === 'landed') chips.push('landed');
    else if (['Departed', 'EnRoute', 'Approaching'].includes(snap?.status ?? ''))
      chips.push('departed');
    else chips.push('on-time');
  }
  return chips.slice(0, 2);
}

/** Tracked values first, then what the user saved (design 20.5). */
export function shownGate(flight: Flight): string | null {
  return flight.watch?.snapshot?.departure.gate ?? flight.depGate;
}
export function shownTerminal(flight: Flight, side: 'dep' | 'arr'): string | null {
  const snap = flight.watch?.snapshot;
  return side === 'dep'
    ? (snap?.departure.terminal ?? flight.depTerminal)
    : (snap?.arrival.terminal ?? flight.arrTerminal);
}

/** Departure order across directions (design 9.2). */
export const byDeparture = (a: Flight, b: Flight) =>
  (a.depSched ?? a.depDateLocal).localeCompare(b.depSched ?? b.depDateLocal) ||
  a.id.localeCompare(b.id);
