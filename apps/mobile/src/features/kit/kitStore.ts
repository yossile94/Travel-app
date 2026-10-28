/**
 * The hotels and insurance of each opened trip (sprint 8 AC-5): read when a
 * trip row opens, on refresh and after a write, and kept for offline viewing
 * in the encrypted copy of ADR-009 under the trips-cache prefix, so every
 * sign-out and account deletion clears it too. The whole copy is encrypted,
 * booking and policy numbers included.
 */
import { useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';
import { secureSessionStorage } from '@/lib/secureSessionStorage';
import { tripsCacheGeneration } from '@/features/trips/tripsCache';

import { loadKit, type Kit } from './kitApi';
import type { Hotel, Insurance } from './kitModel';

export interface TripKit {
  hotels: Hotel[];
  insurance: Insurance | null;
  status: 'loading' | 'ready' | 'error';
  /** Shown from the device copy: offline, read-only. */
  fromCache: boolean;
}

const EMPTY: TripKit = { hotels: [], insurance: null, status: 'loading', fromCache: false };
const CACHE_TRIPS_MAX = 50;

const state = new Map<string, TripKit>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const keyOf = (userId: string) => `trips-cache.kit.${userId}`;

interface Entry {
  tripId: string;
  hotels: Hotel[];
  insurance: Insurance | null;
}

interface KitCache {
  userId: string;
  savedAt: string;
  /** Most recently read first. */
  trips: Entry[];
}

async function userId(): Promise<string | null> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  return data.session?.user.id ?? null;
}

async function readCache(user: string): Promise<KitCache | null> {
  try {
    const text = await secureSessionStorage.getItem(keyOf(user));
    const cache = text ? (JSON.parse(text) as KitCache) : null;
    return cache?.userId === user ? cache : null;
  } catch {
    return null;
  }
}

/** Writes go one at a time, as in flightsStore. */
let writes: Promise<void> = Promise.resolve();

function writeCache(user: string, entries: Entry[], generation: number): Promise<void> {
  writes = writes
    .then(async () => {
      const previous = await readCache(user);
      const ids = new Set(entries.map((e) => e.tripId));
      const trips = [
        ...entries,
        ...(previous?.trips ?? []).filter((t) => !ids.has(t.tripId)),
      ].slice(0, CACHE_TRIPS_MAX);
      if (tripsCacheGeneration() !== generation) return;
      await secureSessionStorage.setItem(
        keyOf(user),
        JSON.stringify({ userId: user, savedAt: new Date().toISOString(), trips }),
      );
      if (tripsCacheGeneration() !== generation) await secureSessionStorage.removeItem(keyOf(user));
    })
    .catch((error) => console.warn('[kit] cache write failed', (error as Error)?.name));
  return writes;
}

const split = (kit: Kit, ids: string[]): Entry[] =>
  ids.map((tripId) => ({
    tripId,
    hotels: kit.hotels.filter((h) => h.tripId === tripId),
    insurance: kit.insurance.find((i) => i.tripId === tripId) ?? null,
  }));

const inFlight = new Map<string, Promise<void>>();
const again = new Set<string>();

/** Reads a trip's kit; offline or failing, falls back to the device copy. */
export function refreshTripKit(tripId: string): Promise<void> {
  const running = inFlight.get(tripId);
  if (running) {
    again.add(tripId);
    return running;
  }
  const generation = tripsCacheGeneration();
  if (!state.get(tripId)) {
    state.set(tripId, EMPTY);
    notify();
  }
  const run = (async () => {
    const result = await loadKit([tripId]);
    const user = await userId();
    // Signed out while reading: nothing of that user comes back into memory (Raz review 4).
    if (tripsCacheGeneration() !== generation) return;
    if (result.ok) {
      const [entry] = split(result.value, [tripId]);
      state.set(tripId, { ...entry!, status: 'ready', fromCache: false });
      notify();
      if (user) await writeCache(user, [entry!], generation);
      return;
    }
    const cached = user ? (await readCache(user))?.trips.find((t) => t.tripId === tripId) : null;
    const prev = state.get(tripId);
    if (cached && result.reason === 'offline') {
      state.set(tripId, {
        hotels: cached.hotels,
        insurance: cached.insurance,
        status: 'ready',
        fromCache: true,
      });
    } else {
      state.set(tripId, {
        hotels: prev?.hotels ?? [],
        insurance: prev?.insurance ?? null,
        status: prev?.status === 'ready' ? 'ready' : 'error',
        fromCache: result.reason === 'offline' && prev?.status === 'ready',
      });
    }
    notify();
  })().finally(() => {
    inFlight.delete(tripId);
    if (again.delete(tripId) && tripsCacheGeneration() === generation) void refreshTripKit(tripId);
  });
  inFlight.set(tripId, run);
  return run;
}

export function useTripKit(tripId: string | null): TripKit {
  return useSyncExternalStore(subscribe, () => (tripId ? (state.get(tripId) ?? EMPTY) : EMPTY));
}

/** The kit of a trip as last read, from memory only (dialogs, SOS). */
export const tripKitNow = (tripId: string): TripKit | null => state.get(tripId) ?? null;

/** The trips just saved to the device copy, in one read: offline, a trip never opened still has its kit. */
export async function prefetchKit(tripIds: string[]): Promise<void> {
  const ids = tripIds.slice(0, 50);
  if (ids.length === 0) return;
  const generation = tripsCacheGeneration();
  const result = await loadKit(ids);
  const user = await userId();
  if (!result.ok || !user) return;
  await writeCache(user, split(result.value, ids), generation);
}

/**
 * The kit of trips that may not be open (SOS, the insurance reminders): the
 * memory, else the device copy. No network (Raz design note 1).
 */
export async function kitsOf(tripIds: string[]): Promise<Map<string, Entry>> {
  const out = new Map<string, Entry>();
  const missing: string[] = [];
  for (const id of tripIds) {
    const s = state.get(id);
    if (s && s.status === 'ready')
      out.set(id, { tripId: id, hotels: s.hotels, insurance: s.insurance });
    else missing.push(id);
  }
  if (missing.length) {
    const user = await userId();
    const cache = user ? await readCache(user) : null;
    for (const t of cache?.trips ?? []) if (missing.includes(t.tripId)) out.set(t.tripId, t);
  }
  return out;
}

/** Forgets everything in memory (sign-out; the device copy goes with clearTripsCaches). */
export function resetKitStore(): void {
  state.clear();
  again.clear();
  notify();
}

/** Whether a trip has hotels or insurance as last read (the trip delete dialog, design 21.9). */
export function tripHasKit(tripId: string): boolean {
  const s = state.get(tripId);
  return !!s && (s.hotels.length > 0 || s.insurance !== null);
}

/** A deleted trip's kit leaves memory and the device copy (Dana 3). */
export async function forgetTripKit(tripId: string): Promise<void> {
  state.delete(tripId);
  notify();
  const user = await userId();
  if (!user) return;
  const generation = tripsCacheGeneration();
  const cache = await readCache(user);
  if (!cache || !cache.trips.some((t) => t.tripId === tripId)) return;
  writes = writes
    .then(async () => {
      if (tripsCacheGeneration() !== generation) return;
      await secureSessionStorage.setItem(
        keyOf(user),
        JSON.stringify({ ...cache, trips: cache.trips.filter((t) => t.tripId !== tripId) }),
      );
    })
    .catch(() => {});
  await writes;
}
