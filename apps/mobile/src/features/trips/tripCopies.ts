/**
 * Sprint 11 AC-13 (Raz ח2, ח3): the encrypted device copies of a trip's board
 * and of its saved places, kept for the active trip and the next 5. They share
 * the trips cache's prefix, so every way out (sign-out, deletion) removes them
 * too; a write that started before a clear removes what it wrote (Dudi e2).
 */
import { secureSessionStorage } from '@/lib/secureSessionStorage';

import { tripsCacheGeneration } from './tripsCache';

/** Raz ח5: the active trip and the next 5 keep a copy. */
export const CACHED_TRIPS = 6;

export type CopyKind = 'itinerary' | 'saved';

const keyOf = (kind: CopyKind, tripId: string) => `trips-cache.${kind}.${tripId}`;

const keep = new Set<string>();

/** The trips whose board and saved places keep a copy, soonest first. */
export function setCachedTrips(tripIds: readonly string[]) {
  keep.clear();
  for (const id of tripIds.slice(0, CACHED_TRIPS)) keep.add(id);
}

export function forgetCachedTrips() {
  keep.clear();
}

export async function readTripCopy<T>(kind: CopyKind, tripId: string): Promise<T | null> {
  try {
    const text = await secureSessionStorage.getItem(keyOf(kind, tripId));
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Only for a kept trip, and only when no clear happened since `startedIn`
 * (the generation when the read began).
 */
export async function writeTripCopy(
  kind: CopyKind,
  tripId: string,
  value: unknown,
  startedIn: number,
): Promise<void> {
  if (!keep.has(tripId) || tripsCacheGeneration() !== startedIn) return;
  try {
    await secureSessionStorage.setItem(keyOf(kind, tripId), JSON.stringify(value));
    if (tripsCacheGeneration() !== startedIn) {
      await secureSessionStorage.removeItem(keyOf(kind, tripId)).catch(() => {});
    }
  } catch (error) {
    // A copy that can't be written is only a missing offline view.
    console.warn(`[${kind}] cache write failed`, (error as Error)?.name);
  }
}
