/**
 * The flight form's values, checks and warnings (sprint 5 design 4, 6), pure
 * so they're tested without the screen.
 */
import { addDays } from '@/features/trips/tripDates';

import type { Airport } from './airportsData';
import {
  DAYS_AHEAD,
  normalizeFlightNumber,
  PNR,
  SEAT,
  type Cabin,
  type Direction,
  type Flight,
  type FlightSnapshot,
} from './flightModel';
import { dayOffset, zonedWall, zonedWallToUtc, type WallResult } from './flightTime';

/** An airport as the form holds it: enough to save, without the bundled list. */
export interface PickedAirport {
  iata: string;
  tz: string;
  country: string | null;
  /** Shown in the field; null when only the code is known (a saved flight). */
  title: string | null;
}

export interface FlightFormValues {
  direction: Direction;
  numberInput: string;
  /** The local departure date (step 1). */
  date: string | null;
  airline: string;
  origin: PickedAirport | null;
  destination: PickedAirport | null;
  depDate: string | null;
  depTime: string | null;
  arrDate: string | null;
  arrTime: string | null;
  depTerminal: string;
  depGate: string;
  arrTerminal: string;
  pnr: string;
  seat: string;
  cabin: Cabin | null;
}

export type FieldError =
  | 'number'
  | 'date'
  | 'tooFar'
  | 'origin'
  | 'destination'
  | 'depTime'
  | 'sameAirport'
  | 'arrBeforeDep'
  | 'pnr'
  | 'seat';

export type Errors = Partial<
  Record<
    'number' | 'date' | 'origin' | 'destination' | 'depTime' | 'arrTime' | 'pnr' | 'seat',
    FieldError
  >
>;

export const pickedFrom = (a: Airport, title: string): PickedAirport => ({
  iata: a.iata,
  tz: a.tz,
  country: a.country,
  title,
});

/** The direction a new flight starts with (design 2.1). */
export function defaultDirection(existing: Pick<Flight, 'direction'>[]): Direction {
  if (!existing.some((f) => f.direction === 'out')) return 'out';
  if (!existing.some((f) => f.direction === 'return')) return 'return';
  return 'internal';
}

/** The date a direction suggests (design 2.1): the trip's start, its return, or none. */
export function defaultDate(
  direction: Direction,
  trip: { startDate: string; endDate: string },
): string | null {
  return direction === 'out' ? trip.startDate : direction === 'return' ? trip.endDate : null;
}

export function emptyValues(direction: Direction, date: string | null): FlightFormValues {
  return {
    direction,
    numberInput: '',
    date,
    airline: '',
    origin: null,
    destination: null,
    depDate: date,
    depTime: null,
    arrDate: date,
    arrTime: null,
    depTerminal: '',
    depGate: '',
    arrTerminal: '',
    pnr: '',
    seat: '',
    cabin: null,
  };
}

/** A saved flight back into the form (editing shows the saved values, Raz Q5). */
export function valuesOf(f: Flight): FlightFormValues {
  const dep = f.depSched ? zonedWall(f.depTz, new Date(f.depSched)) : null;
  const arr = f.arrSched && f.arrTz ? zonedWall(f.arrTz, new Date(f.arrSched)) : null;
  return {
    direction: f.direction,
    numberInput: f.number,
    date: f.depDateLocal,
    airline: f.airline ?? '',
    origin: { iata: f.depIata, tz: f.depTz, country: f.depCountry, title: null },
    destination:
      f.arrIata && f.arrTz
        ? { iata: f.arrIata, tz: f.arrTz, country: f.arrCountry, title: null }
        : null,
    depDate: dep?.date ?? f.depDateLocal,
    depTime: dep?.time ?? null,
    arrDate: arr?.date ?? f.depDateLocal,
    arrTime: arr?.time ?? null,
    depTerminal: f.depTerminal ?? '',
    depGate: f.depGate ?? '',
    arrTerminal: f.arrTerminal ?? '',
    pnr: f.pnr ?? '',
    seat: f.seat ?? '',
    cabin: f.cabin,
  };
}

/**
 * A provider leg over the form: only what the provider returns is replaced
 * (design 4.1); direction, booking code, seat and class stay.
 */
export function withLeg(
  values: FlightFormValues,
  leg: FlightSnapshot,
  airport: (iata: string | null) => PickedAirport | null,
): FlightFormValues {
  const dep = leg.departure;
  const arr = leg.arrival;
  const origin =
    airport(dep.iata) ??
    (dep.iata && dep.timeZone
      ? { iata: dep.iata, tz: dep.timeZone, country: null, title: null }
      : null);
  const destination =
    airport(arr.iata) ??
    (arr.iata && arr.timeZone
      ? { iata: arr.iata, tz: arr.timeZone, country: null, title: null }
      : null);
  const depWall =
    origin && dep.scheduledUtc ? zonedWall(origin.tz, new Date(dep.scheduledUtc)) : null;
  const arrWall =
    destination && arr.scheduledUtc ? zonedWall(destination.tz, new Date(arr.scheduledUtc)) : null;
  return {
    ...values,
    airline: leg.airlineName ?? values.airline,
    origin: origin ?? values.origin,
    destination: destination ?? values.destination,
    depDate: depWall?.date ?? values.depDate,
    depTime: depWall?.time ?? null,
    arrDate: arrWall?.date ?? depWall?.date ?? values.arrDate,
    arrTime: arrWall?.time ?? null,
    depTerminal: dep.terminal ?? '',
    depGate: dep.gate ?? '',
    arrTerminal: arr.terminal ?? '',
  };
}

/** Step 1: a flight number and a date no more than 355 days ahead (design 6). */
/**
 * v0.14.1 (Raz 4): a new departure date moves the arrival date by as many
 * days, so a flight keeps its length (no "+2" from an edit, no false "arrives
 * before it leaves"). No arrival date yet: the same day.
 */
export function withDepartureDate(
  values: Pick<FlightFormValues, 'date' | 'depDate' | 'arrDate'>,
  picked: string,
): Pick<FlightFormValues, 'date' | 'depDate' | 'arrDate'> {
  const before = values.depDate ?? values.date;
  const arrDate =
    values.arrDate && before ? addDays(values.arrDate, dayOffset(before, picked)) : picked;
  return { date: picked, depDate: picked, arrDate };
}

export function checkSearch(values: FlightFormValues, today: string): Errors {
  const errors: Errors = {};
  if (!normalizeFlightNumber(values.numberInput)) errors.number = 'number';
  if (!values.date) errors.date = 'date';
  else if (values.date > addDays(today, DAYS_AHEAD)) errors.date = 'tooFar';
  return errors;
}

const wall = (
  date: string | null,
  time: string | null,
  tz: string | undefined,
): WallResult | null => (date && time && tz ? zonedWallToUtc(date, time, tz) : null);

/** Step 2: everything save needs (design 4.3, 6). */
export function checkDetails(values: FlightFormValues, today: string): Errors {
  const errors = checkSearch(values, today);
  if (!values.origin) errors.origin = 'origin';
  if (!values.destination) errors.destination = 'destination';
  else if (values.origin && values.origin.iata === values.destination.iata)
    errors.destination = 'sameAirport';
  if (!values.depTime) errors.depTime = 'depTime';
  const dep = wall(values.depDate, values.depTime, values.origin?.tz);
  const arr = wall(values.arrDate, values.arrTime, values.destination?.tz);
  if (dep && arr && arr.utc.getTime() <= dep.utc.getTime()) errors.arrTime = 'arrBeforeDep';
  if (values.pnr && !PNR.test(values.pnr)) errors.pnr = 'pnr';
  if (values.seat && !SEAT.test(values.seat)) errors.seat = 'seat';
  return errors;
}

export type Warning =
  | { kind: 'past' }
  | { kind: 'outsideTrip' }
  | { kind: 'dst'; side: 'dep' | 'arr'; result: Exclude<WallResult, { kind: 'ok' }> };

/** Warnings never block a save (design 6). */
export function warnings(
  values: FlightFormValues,
  trip: { startDate: string; endDate: string },
  now: Date,
): Warning[] {
  const out: Warning[] = [];
  const dep = wall(values.depDate, values.depTime, values.origin?.tz);
  const departed = dep
    ? dep.utc.getTime() < now.getTime()
    : values.date !== null &&
      values.origin !== null &&
      values.date < zonedWall(values.origin.tz, now).date;
  if (departed) out.push({ kind: 'past' });
  if (
    values.date &&
    (values.date < addDays(trip.startDate, -1) || values.date > addDays(trip.endDate, 1))
  ) {
    out.push({ kind: 'outsideTrip' });
  }
  if (dep && dep.kind !== 'ok') out.push({ kind: 'dst', side: 'dep', result: dep });
  const arr = wall(values.arrDate, values.arrTime, values.destination?.tz);
  if (arr && arr.kind !== 'ok') out.push({ kind: 'dst', side: 'arr', result: arr });
  return out;
}

/** What save_flight receives (the device id and trip go beside it). */
export function toSaved(values: FlightFormValues) {
  const number = normalizeFlightNumber(values.numberInput)!;
  const dep = wall(values.depDate, values.depTime, values.origin?.tz);
  const arr = wall(values.arrDate, values.arrTime, values.destination?.tz);
  const trim = (s: string) => s.trim() || null;
  return {
    direction: values.direction,
    numberInput: values.numberInput.trim() || number,
    number,
    depDateLocal: values.date!,
    airline: trim(values.airline),
    depIata: values.origin!.iata,
    depTz: values.origin!.tz,
    depCountry: values.origin!.country,
    arrIata: values.destination?.iata ?? null,
    arrTz: values.destination?.tz ?? null,
    arrCountry: values.destination?.country ?? null,
    depSched: dep?.utc.toISOString() ?? null,
    arrSched: arr?.utc.toISOString() ?? null,
    depTerminal: trim(values.depTerminal),
    depGate: trim(values.depGate),
    arrTerminal: trim(values.arrTerminal),
    arrGate: null,
    pnr: trim(values.pnr),
    seat: trim(values.seat),
    cabin: values.cabin,
  };
}

/** Changed since the screen opened, the provider's fill included (design 8.2). */
export const changed = (a: FlightFormValues, b: FlightFormValues) =>
  JSON.stringify(a) !== JSON.stringify(b);

/**
 * Sprint 7: the form's flight as a leg, for the connection rule (design 6.2);
 * null until it has a departure airport, date and time.
 */
export function draftLeg(
  values: FlightFormValues,
  id: string,
  tripId: string,
): Pick<
  Flight,
  'id' | 'tripId' | 'direction' | 'depIata' | 'arrIata' | 'depSched' | 'arrSched'
> | null {
  const dep = wall(values.depDate, values.depTime, values.origin?.tz);
  if (!values.origin || !dep) return null;
  const arr = wall(values.arrDate, values.arrTime, values.destination?.tz);
  return {
    id,
    tripId,
    direction: values.direction,
    depIata: values.origin.iata,
    arrIata: values.destination?.iata ?? null,
    depSched: dep.utc.toISOString(),
    arrSched: arr?.utc.toISOString() ?? null,
  };
}

/**
 * Design 6.1: a new flight that continues one of the trip's flights (it
 * leaves from where that one lands, after it and within 24 hours) starts in
 * that flight's direction. The nearest landing before the departure wins.
 */
export function continuedDirection(
  draft: ReturnType<typeof draftLeg>,
  flights: Flight[],
): { direction: Direction; prev: Flight } | null {
  if (!draft?.depSched) return null;
  const leaves = Date.parse(draft.depSched);
  let best: Flight | null = null;
  for (const f of flights) {
    if (f.id === draft.id || f.arrIata !== draft.depIata || !f.arrSched) continue;
    const landed = Date.parse(f.arrSched);
    if (leaves <= landed || leaves - landed > 24 * 60 * 60_000) continue;
    if (!best || landed > Date.parse(best.arrSched!)) best = f;
  }
  return best ? { direction: best.direction, prev: best } : null;
}
