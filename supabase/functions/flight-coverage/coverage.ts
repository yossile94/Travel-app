/**
 * The Sprint 5 coverage gate (Raz, B-2). It covers 15 flights of LY, 6H and
 * IZ from TLV. Each flight is probed 150 and 75 minutes before its scheduled
 * departure, and 30 minutes after it. A flight passes when one of the early
 * probes has a live time or a gate, and the late probe shows it departed.
 * The gate passes at 10 of 15. A flight delayed past the +30 probe gets one
 * more probe 30 minutes after its new time; a cancelled flight leaves the
 * count, which is reported (Raz, gate #4, #5).
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
export type ProbeKind = (typeof PROBES)[number]['kind'] | 'retry';

const DEPARTED = new Set(['Departed', 'EnRoute', 'Approaching', 'Arrived']);
const TLV_ZONE = 'Asia/Jerusalem';

/** The local date at TLV of a UTC time (Raz, gate #3: windows may cross midnight). */
export function tlvDate(utcIso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TLV_ZONE }).format(new Date(utcIso));
}

const departed = (s: FlightSnapshot) => DEPARTED.has(s.status) || s.departure.runwayUtc !== null;

/**
 * After the +30 probe: when the flight hasn't left and the provider has a
 * later time for it, one more probe 30 minutes after that time.
 */
export function retryAt(after: FlightSnapshot, probedAt: Date): string | null {
  if (departed(after) || after.status === 'Canceled') return null;
  const times = [after.departure.revisedUtc, after.departure.predictedUtc]
    .filter((t): t is string => t !== null)
    .map(Date.parse);
  if (times.length === 0) return null;
  const at = Math.max(...times) + 30 * 60_000;
  return at > probedAt.getTime() ? new Date(at).toISOString() : null;
}

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
  const left = [probes.after, probes.retry].some((s) => s != null && departed(s));
  return { live, departed: left, pass: live && left };
}

export type GateRow = {
  flight_number: string;
  probe_kind: ProbeKind;
  snapshot: FlightSnapshot | null;
};

/** The whole gate from the stored probes, reproducible for the report (Raz, gate #11). */
export function gateResult(rows: GateRow[]) {
  const byFlight = new Map<string, Partial<Record<ProbeKind, FlightSnapshot | null>>>();
  for (const r of rows) {
    const probes = byFlight.get(r.flight_number) ?? {};
    probes[r.probe_kind] = r.snapshot;
    byFlight.set(r.flight_number, probes);
  }
  const flights = [...byFlight].map(([number, probes]) => {
    const cancelled = Object.values(probes).some((s) => s?.status === 'Canceled');
    return { number, cancelled, ...verdict(probes) };
  });
  const counted = flights.filter((f) => !f.cancelled);
  const passed = counted.filter((f) => f.pass).length;
  return { flights, counted: counted.length, passed, gate: passed >= PASS_AT };
}
