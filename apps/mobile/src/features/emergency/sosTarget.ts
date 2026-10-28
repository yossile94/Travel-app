/**
 * Which trip the SOS button and screen are for (sprint 8 AC-16, design
 * 13.2). Never the country selected on the globe (spec 5.6): only active
 * trips, by the device's date.
 *   1. A trip with a flight today: the one of the last flight that landed
 *      (landed, or its scheduled arrival passed); none yet: today's first.
 *   2. Else the latest start date; equal ones keep the given (stable) order.
 */
import type { Flight } from '@/features/flights/flightModel';
import { isActive } from '@/features/trips/tripDates';

export interface SosTrip {
  id: string;
  countryAdm0: string;
  title: string;
  startDate: string;
  endDate: string;
}

const arrived = (f: Flight, now: Date) => {
  const at = f.watch?.landedAt ?? f.arrSched;
  return at !== null && at !== undefined && Date.parse(at) <= now.getTime();
};
const arrivalTime = (f: Flight) => Date.parse(f.watch?.landedAt ?? f.arrSched ?? f.depSched ?? '');
const departure = (f: Flight) => Date.parse(f.depSched ?? `${f.depDateLocal}T00:00:00Z`);

export function activeTrips<T extends SosTrip>(trips: readonly T[], today: string): T[] {
  return trips.filter((t) => isActive(t.startDate, t.endDate, today));
}

export function sosTarget<T extends SosTrip>(
  trips: readonly T[],
  flightsOf: (tripId: string) => readonly Flight[],
  today: string,
  now = new Date(),
): T | null {
  const active = activeTrips(trips, today);
  if (active.length <= 1) return active[0] ?? null;
  const todays = active.flatMap((t) =>
    flightsOf(t.id)
      .filter((f) => f.depDateLocal === today)
      .map((f) => ({ trip: t, f })),
  );
  if (todays.length) {
    const landed = todays.filter((x) => arrived(x.f, now));
    if (landed.length)
      return landed.reduce((a, b) => (arrivalTime(b.f) > arrivalTime(a.f) ? b : a)).trip;
    return todays.reduce((a, b) => (departure(b.f) < departure(a.f) ? b : a)).trip;
  }
  return active.reduce((a, b) => (b.startDate > a.startDate ? b : a));
}

/** The picker's order (design 13.2): the target first, then by start date, latest first. */
export function pickerOrder<T extends SosTrip>(active: readonly T[], target: T | null): T[] {
  const rest = active
    .filter((t) => t !== target)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return target ? [target, ...rest] : rest;
}
