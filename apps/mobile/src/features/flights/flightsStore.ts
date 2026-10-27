/**
 * The flights of each opened trip (sprint 5, design 12): read through the
 * owner RPC when a trip row opens, on refresh, and after a save or delete;
 * kept for offline viewing in the encrypted copy of ADR-009 (AC-5), under the
 * trips-cache prefix, so every sign-out and account deletion clears it too.
 */
import { useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';
import { secureSessionStorage } from '@/lib/secureSessionStorage';
import { tripsCacheGeneration } from '@/features/trips/tripsCache';

import { ownWatch, type Flight } from './flightModel';
import { loadFlights } from './flightsApi';

export interface TripFlights {
  flights: Flight[];
  status: 'loading' | 'ready' | 'error';
  /** Shown from the device copy: offline, read-only. */
  fromCache: boolean;
  /** When the device copy was saved, for "מוצג מהשמירה האחרונה". */
  savedAt: string | null;
}

const EMPTY: TripFlights = { flights: [], status: 'loading', fromCache: false, savedAt: null };
/** Trips kept in the device copy; the oldest read goes first. */
const CACHE_TRIPS_MAX = 30;
/** Changes kept per flight in the device copy (the sheet online shows up to 50, Raz 5). */
const CACHE_EVENTS_MAX = 10;
/** AeroDataBox's cache terms: provider data 7 days after landing (AC-7א, Raz). */
const PROVIDER_DATA_DAYS = 7;

const state = new Map<string, TripFlights>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const keyOf = (userId: string) => `trips-cache.flights.${userId}`;

interface FlightsCache {
  userId: string;
  savedAt: string;
  /** Most recently read first. */
  trips: { tripId: string; flights: Flight[] }[];
}

/** Drops provider data the terms don't let us keep, even offline. */
export function withoutExpiredProviderData(flights: Flight[], now = new Date()): Flight[] {
  const limit = now.getTime() - PROVIDER_DATA_DAYS * 24 * 60 * 60_000;
  return flights.map((f) => {
    const end = f.watch?.landedAt ?? f.arrSched ?? f.depSched ?? `${f.depDateLocal}T23:59:59Z`;
    return f.watch && Date.parse(end) < limit ? { ...f, watch: null } : f;
  });
}

/** Only this flight's own leg counts (Raz 3). */
const own = (flights: Flight[]) => flights.map((f) => ({ ...f, watch: ownWatch(f) }));

async function userId(): Promise<string | null> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.user.id ?? null;
}

async function readCache(user: string): Promise<FlightsCache | null> {
  try {
    const text = await secureSessionStorage.getItem(keyOf(user));
    const cache = text ? (JSON.parse(text) as FlightsCache) : null;
    return cache?.userId === user ? cache : null;
  } catch {
    return null;
  }
}

const slim = (flights: Flight[]) =>
  flights.map((f) =>
    f.watch
      ? { ...f, watch: { ...f.watch, events: f.watch.events.slice(0, CACHE_EVENTS_MAX) } }
      : f,
  );

type Entry = { tripId: string; flights: Flight[] };

/** Writes go one at a time: two refreshes never overwrite each other's trip (Raz 5). */
let writes: Promise<void> = Promise.resolve();

function writeCache(user: string, entries: Entry[], generation: number): Promise<void> {
  writes = writes.then(() => writeCacheNow(user, entries, generation)).catch(() => {});
  return writes;
}

async function writeCacheNow(user: string, entries: Entry[], generation: number) {
  const previous = await readCache(user);
  const ids = new Set(entries.map((e) => e.tripId));
  const trips = [
    ...entries.map((e) => ({ tripId: e.tripId, flights: slim(e.flights) })),
    ...(previous?.trips ?? []).filter((t) => !ids.has(t.tripId)),
  ].slice(0, CACHE_TRIPS_MAX);
  // A sign-out since the read started: write nothing (as tripsCache, Dudi e2).
  if (tripsCacheGeneration() !== generation) return;
  try {
    await secureSessionStorage.setItem(
      keyOf(user),
      JSON.stringify({ userId: user, savedAt: new Date().toISOString(), trips }),
    );
    if (tripsCacheGeneration() !== generation) await secureSessionStorage.removeItem(keyOf(user));
  } catch (error) {
    console.warn('[flights] cache write failed', (error as Error)?.name);
  }
}

const inFlight = new Map<string, Promise<void>>();
const again = new Set<string>();

/** Reads a trip's flights; offline or failing, falls back to the device copy. */
export function refreshTripFlights(tripId: string): Promise<void> {
  const running = inFlight.get(tripId);
  if (running) {
    // Asked after the read began (a save, a delete): read once more when it ends (Raz 4).
    again.add(tripId);
    return running;
  }
  const generation = tripsCacheGeneration();
  if (!state.get(tripId)) {
    state.set(tripId, EMPTY);
    notify();
  }
  const run = (async () => {
    const result = await loadFlights([tripId]);
    const user = await userId();
    if (result.ok) {
      const flights = own(result.value);
      state.set(tripId, { flights, status: 'ready', fromCache: false, savedAt: null });
      notify();
      if (user) await writeCache(user, [{ tripId, flights }], generation);
      return;
    }
    const cache = user ? await readCache(user) : null;
    const cached = cache?.trips.find((t) => t.tripId === tripId);
    if (cached && result.reason === 'offline') {
      state.set(tripId, {
        flights: withoutExpiredProviderData(cached.flights),
        status: 'ready',
        fromCache: true,
        savedAt: cache!.savedAt,
      });
    } else {
      const prev = state.get(tripId);
      state.set(tripId, {
        flights: prev?.flights ?? [],
        status: prev && prev.status === 'ready' ? 'ready' : 'error',
        fromCache: result.reason === 'offline' && !!prev?.flights.length,
        savedAt: prev?.savedAt ?? null,
      });
    }
    notify();
  })().finally(() => {
    inFlight.delete(tripId);
    if (again.delete(tripId)) void refreshTripFlights(tripId);
  });
  inFlight.set(tripId, run);
  return run;
}

/** The flights of one trip; null id: nothing. */
export function useTripFlights(tripId: string | null): TripFlights {
  return useSyncExternalStore(subscribe, () => (tripId ? (state.get(tripId) ?? EMPTY) : EMPTY));
}

/** Whether a trip's flights, as last read, are any (the trip delete dialog, design 8.3). */
export function tripHasFlights(tripId: string): boolean {
  return (state.get(tripId)?.flights.length ?? 0) > 0;
}

/**
 * The flights of the trips just saved to the device copy, in one read (Raz 6):
 * a trip never opened online still shows its flights offline (AC-5).
 */
export async function prefetchFlights(tripIds: string[]): Promise<void> {
  const ids = tripIds.slice(0, 50);
  if (ids.length === 0) return;
  const generation = tripsCacheGeneration();
  const result = await loadFlights(ids);
  const user = await userId();
  if (!result.ok || !user) return;
  const byTrip = new Map<string, Flight[]>(ids.map((id) => [id, []]));
  for (const f of own(result.value)) byTrip.get(f.tripId)?.push(f);
  await writeCache(
    user,
    [...byTrip].map(([tripId, flights]) => ({ tripId, flights })),
    generation,
  );
}

/** Forgets everything in memory (sign-out; the device copy goes with clearTripsCaches). */
export function resetFlightsStore(): void {
  state.clear();
  again.clear();
  notify();
}

/** The whole lookup of a tapped alert's flight, then as "offline" (design 4.5). */
export const OPEN_TIMEOUT_MS = 8000;

/**
 * The trip of one of the user's flights (sprint 6 AC-5: a tapped alert): from
 * memory, the device copy, or the server through RLS, in that order. "gone"
 * also when it is someone else's: the two look the same (design 4.3).
 */
export async function tripOfFlight(flightId: string): Promise<string | 'gone' | 'offline'> {
  for (const [tripId, t] of state) if (t.flights.some((f) => f.id === flightId)) return tripId;
  const user = await userId();
  if (!user) return 'gone';
  const cache = await readCache(user);
  const cached = cache?.trips.find((t) => t.flights.some((f) => f.id === flightId));
  if (cached) return cached.tripId;
  if (!supabase) return 'offline';
  const read = supabase.from('flights').select('trip_id').eq('id', flightId).maybeSingle();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const answer = await Promise.race([
    Promise.resolve(read).catch(() => null),
    new Promise<null>((r) => (timer = setTimeout(() => r(null), OPEN_TIMEOUT_MS))),
  ]).finally(() => clearTimeout(timer));
  if (!answer || answer.error) return 'offline';
  return (answer.data as { trip_id: string } | null)?.trip_id ?? 'gone';
}

/** Whether a loaded flight has this number (the explainer's sample avoids it, design 2.5). */
export function hasFlightNumber(number: string): boolean {
  for (const t of state.values()) if (t.flights.some((f) => f.number === number)) return true;
  return false;
}

/** Every trip read so far, read again (an alert arrived while the app was open, AC-5א). */
export function refreshOpenTrips(): void {
  for (const tripId of state.keys()) void refreshTripFlights(tripId);
}
