/**
 * Flights on the server (sprint 5 F-016, F-017, ADR-010). Like tripsApi:
 * every call answers with a named result, and logs carry a code only, never
 * a flight number, date, airport or booking code (design 20.12).
 */
import NetInfo from '@react-native-community/netinfo';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

import type { Flight, FlightSnapshot } from './flightModel';

export type FlightWrite = 'ok' | 'offline' | 'consent' | 'gone' | 'limit' | 'trackLimit' | 'error';

export type LookupResult =
  | { kind: 'found'; legs: FlightSnapshot[] }
  | { kind: 'notFound' }
  | { kind: 'unavailable' }
  | { kind: 'rateLimited' }
  | { kind: 'offline' };

const SEARCH_TIMEOUT_MS = 15_000;

function log(step: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`[flights] ${step} failed`, typeof code === 'string' ? code : 'no code');
}

async function online(): Promise<boolean> {
  return (await NetInfo.fetch()).isConnected !== false;
}

/** The provider answer as the form reads it; exported for tests. */
export function lookupFrom(status: number, body: unknown): LookupResult {
  const fields = (body ?? {}) as { legs?: unknown; error?: unknown };
  if (status === 200 && Array.isArray(fields.legs)) {
    return fields.legs.length > 0
      ? { kind: 'found', legs: fields.legs as FlightSnapshot[] }
      : { kind: 'notFound' };
  }
  if (status === 429) return { kind: 'rateLimited' };
  return { kind: 'unavailable' };
}

/** Search by number and local date; 15 seconds, then "unavailable" (design 2.2). */
export async function lookupFlight(number: string, date: string): Promise<LookupResult> {
  if (!supabase) return { kind: 'unavailable' };
  if (!(await online())) return { kind: 'offline' };
  const call = supabase.functions
    .invoke('flight-lookup', { body: { number, date }, timeout: SEARCH_TIMEOUT_MS })
    .then(async ({ data, error }): Promise<LookupResult> => {
      if (!error) return lookupFrom(200, data);
      if (error instanceof FunctionsHttpError) {
        const response = error.context as Response;
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          // Outside the contract: unavailable.
        }
        const result = lookupFrom(response.status, body);
        if (result.kind === 'unavailable') console.error('[flights] flight_lookup_unavailable');
        return result;
      }
      console.error('[flights] flight_lookup_unavailable');
      return { kind: 'unavailable' };
    })
    .catch((): LookupResult => ({ kind: 'unavailable' }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LookupResult>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'unavailable' }), SEARCH_TIMEOUT_MS + 1000);
  });
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}

/** The owner's flights for trips (at most 50), with tracking state and changes. */
export async function loadFlights(
  tripIds: string[],
): Promise<{ ok: true; value: Flight[] } | { ok: false; reason: 'offline' | 'error' }> {
  if (!supabase) return { ok: false, reason: 'error' };
  if (tripIds.length === 0) return { ok: true, value: [] };
  if (!(await online())) return { ok: false, reason: 'offline' };
  const { data, error } = await supabase.rpc('flights_for_trips', {
    p_trip_ids: tripIds.slice(0, 50),
  });
  if (error || !Array.isArray(data)) {
    log('load', error);
    return { ok: false, reason: 'error' };
  }
  return { ok: true, value: data as Flight[] };
}

type SavedFields = Omit<Flight, 'id' | 'tripId' | 'watch'>;

/** One flight, with the id made when the screen opened (AC-5: a retry writes the same row). */
export async function saveFlight(
  id: string,
  tripId: string,
  flight: SavedFields,
): Promise<FlightWrite> {
  if (!supabase) return 'error';
  if (!(await online())) return 'offline';
  const { data, error } = await supabase.rpc('save_flight', {
    p_id: id,
    p_trip_id: tripId,
    p_flight: flight,
  });
  if (error) {
    const { code, hint } = error as { code?: string; hint?: string };
    if (code === '42501' && hint === 'consent_required') return 'consent';
    log('save', error);
    return 'error';
  }
  if (data === 'track_limit') return 'trackLimit';
  return data === 'ok' || data === 'gone' || data === 'limit' ? data : 'error';
}

/** Deletes one flight; never gated by consent. 'gone': already deleted. */
export async function deleteFlight(id: string): Promise<FlightWrite> {
  if (!supabase) return 'error';
  if (!(await online())) return 'offline';
  const { data, error } = await supabase.rpc('delete_flight', { p_id: id });
  if (error) {
    log('delete', error);
    return 'error';
  }
  return data === 'gone' ? 'gone' : 'ok';
}
