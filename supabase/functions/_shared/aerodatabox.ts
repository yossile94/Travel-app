/**
 * AeroDataBox through RapidAPI (ADR-010), behind the FlightProvider shape so
 * tests use a fake and never call the network. Free plan: 400 units a month,
 * one request a second; flight status by number and FIDS cost 2 units each
 * (Tier 2), the feed health check is free.
 */

export type MovementTimes = {
  iata: string | null;
  timeZone: string | null;
  scheduledUtc: string | null;
  revisedUtc: string | null;
  predictedUtc: string | null;
  runwayUtc: string | null;
  terminal: string | null;
  gate: string | null;
  /** Basic, Live and/or Approximate: whether the times are live. */
  quality: string[];
};

export type FlightSnapshot = {
  number: string;
  airlineIata: string | null;
  airlineName: string | null;
  status: string;
  codeshareStatus: string | null;
  isCargo: boolean;
  departure: MovementTimes;
  arrival: MovementTimes;
};

export type ProviderAnswer<T> =
  { ok: true; value: T; units: number } | { ok: false; status: number; units: number };

export type FlightProvider = {
  /** Every leg of a flight number on a local departure date. */
  flightsByNumber(number: string, dateLocal: string): Promise<ProviderAnswer<FlightSnapshot[]>>;
  /** Departures from an airport in a local time window (12 hours at most). */
  departures(
    iata: string,
    fromLocal: string,
    toLocal: string,
  ): Promise<ProviderAnswer<FlightSnapshot[]>>;
};

const HOST = 'aerodatabox.p.rapidapi.com';
export const UNITS = { flight: 2, fids: 2 } as const;

type RawTime = { utc?: string | null } | null | undefined;
type RawMovement = {
  airport?: { iata?: string | null; timeZone?: string | null } | null;
  scheduledTime?: RawTime;
  revisedTime?: RawTime;
  predictedTime?: RawTime;
  runwayTime?: RawTime;
  terminal?: string | null;
  gate?: string | null;
  quality?: string[] | null;
} | null;
export type RawFlight = {
  number?: string | null;
  status?: string | null;
  codeshareStatus?: string | null;
  isCargo?: boolean | null;
  airline?: { iata?: string | null; name?: string | null } | null;
  departure?: RawMovement;
  arrival?: RawMovement;
  /** FIDS rows carry the airport's own side here instead. */
  movement?: RawMovement;
};

/** "2026-10-27 06:05Z" → ISO, or null. */
function utc(time: RawTime): string | null {
  const value = time?.utc;
  if (!value) return null;
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function movement(raw: RawMovement): MovementTimes {
  return {
    iata: raw?.airport?.iata ?? null,
    timeZone: raw?.airport?.timeZone ?? null,
    scheduledUtc: utc(raw?.scheduledTime),
    revisedUtc: utc(raw?.revisedTime),
    predictedUtc: utc(raw?.predictedTime),
    runwayUtc: utc(raw?.runwayTime),
    terminal: raw?.terminal?.trim() || null,
    gate: raw?.gate?.trim() || null,
    quality: raw?.quality ?? [],
  };
}

/** "LY 1" → "LY1"; the provider spaces the airline code from the number. */
export const normalizeNumber = (n: string) => n.replace(/\s+/g, '').toUpperCase();

/**
 * One provider flight as our snapshot. A FIDS row has the airport's own side
 * in `movement`, or, with withLeg=true, in `departure` like a flight answer.
 */
export function toSnapshot(raw: RawFlight, fidsSide?: 'departure' | 'arrival'): FlightSnapshot {
  const departure = fidsSide === 'departure' ? (raw.movement ?? raw.departure) : raw.departure;
  const arrival = fidsSide === 'arrival' ? (raw.movement ?? raw.arrival) : raw.arrival;
  return {
    number: normalizeNumber(raw.number ?? ''),
    airlineIata: raw.airline?.iata ?? null,
    airlineName: raw.airline?.name?.trim() || null,
    status: raw.status ?? 'Unknown',
    codeshareStatus: raw.codeshareStatus ?? null,
    isCargo: raw.isCargo === true,
    departure: movement(departure ?? null),
    arrival: movement(arrival ?? null),
  };
}

export function aeroDataBox(key: string, fetchFn: typeof fetch = fetch): FlightProvider {
  // Never throws (Raz, gate #1): a network error or timeout is status 0, so
  // callers always record the attempt they already paid for.
  const get = async (path: string, units: number) => {
    try {
      const response = await fetchFn(`https://${HOST}${path}`, {
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST },
        signal: AbortSignal.timeout(20_000),
      });
      // 204: the provider knows no such flight. RapidAPI bills it all the same.
      if (response.status === 204) return { ok: true as const, body: null, units };
      if (!response.ok) return { ok: false as const, status: response.status, units };
      return { ok: true as const, body: (await response.json()) as unknown, units };
    } catch {
      return { ok: false as const, status: 0, units };
    }
  };
  return {
    async flightsByNumber(number, dateLocal) {
      const r = await get(
        `/flights/number/${encodeURIComponent(number)}/${dateLocal}?dateLocalRole=Departure&withAircraftImage=false&withLocation=false`,
        UNITS.flight,
      );
      if (!r.ok) return r;
      const rows = Array.isArray(r.body) ? (r.body as RawFlight[]) : [];
      return { ok: true, value: rows.map((f) => toSnapshot(f)), units: r.units };
    },
    async departures(iata, fromLocal, toLocal) {
      const r = await get(
        `/flights/airports/iata/${iata}/${fromLocal}/${toLocal}?direction=Departure&withLeg=true&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`,
        UNITS.fids,
      );
      if (!r.ok) return r;
      const rows = ((r.body as { departures?: RawFlight[] } | null)?.departures ??
        []) as RawFlight[];
      return { ok: true, value: rows.map((f) => toSnapshot(f, 'departure')), units: r.units };
    },
  };
}
