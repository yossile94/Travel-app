/**
 * The Sprint 5 coverage gate (Raz, B-2). It covers 15 flights of LY, 6H and
 * IZ from TLV. Each flight is probed 150 and 75 minutes before its scheduled
 * departure, and 30 minutes after it. A flight passes when one of the early
 * probes has a live time or a gate, and the late probe shows it departed.
 * The gate passes at 10 of 15.
 */
import type { FlightSnapshot } from '../_shared/aerodatabox.ts';

export const AIRLINES = ['LY', '6H', 'IZ'] as const;
export const PER_AIRLINE = 5;
export const PASS_AT = 10;
export const PROBES = [
  { kind: 'early', minutes: -150 },
  { kind: 'late', minutes: -75 },
  { kind: 'after', minutes: 30 },
] as const;
export type ProbeKind = (typeof PROBES)[number]['kind'];

const DEPARTED = new Set(['Departed', 'EnRoute', 'Approaching', 'Arrived']);

/**
 * Picks up to 5 operated passenger flights per airline, spread across the
 * window: every n-th one, so the gate is not decided by a single bank of flights.
 */
export function pickFlights(
  departures: FlightSnapshot[],
  earliestDeparture: Date,
): FlightSnapshot[] {
  const picked: FlightSnapshot[] = [];
  for (const airline of AIRLINES) {
    const own = departures
      .filter(
        (f) =>
          f.airlineIata === airline &&
          f.codeshareStatus !== 'IsCodeshared' &&
          !f.isCargo &&
          f.status !== 'Canceled' &&
          f.departure.scheduledUtc !== null &&
          new Date(f.departure.scheduledUtc) >= earliestDeparture,
      )
      .sort((a, b) => a.departure.scheduledUtc!.localeCompare(b.departure.scheduledUtc!));
    const unique = own.filter((f, i) => own.findIndex((g) => g.number === f.number) === i);
    const step = Math.max(1, Math.floor(unique.length / PER_AIRLINE));
    for (
      let i = 0;
      i < unique.length && picked.filter((f) => f.airlineIata === airline).length < PER_AIRLINE;
      i += step
    ) {
      picked.push(unique[i]);
    }
  }
  return picked;
}

/** A provider time counts as live only when the provider says so. */
function hasLiveDeparture(s: FlightSnapshot): boolean {
  const live = s.departure.quality.some((q) => q === 'Live' || q === 'Approximate');
  return (
    s.departure.gate !== null ||
    (live && (s.departure.revisedUtc !== null || s.departure.predictedUtc !== null))
  );
}

export type Verdict = { live: boolean; departed: boolean; pass: boolean };

export function verdict(probes: Partial<Record<ProbeKind, FlightSnapshot | null>>): Verdict {
  const live = [probes.early, probes.late].some((s) => s != null && hasLiveDeparture(s));
  const after = probes.after;
  const departed =
    after != null && (DEPARTED.has(after.status) || after.departure.runwayUtc !== null);
  return { live, departed, pass: live && departed };
}
