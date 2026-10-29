/**
 * Sprint 11 AC-6 (design 5.2, 6; D3, D4): a trip's saved places. Read from
 * the server and kept for the session; written only through save_place and
 * unsave_place, never optimistically. A save keeps a snapshot of the name and
 * the point, so a place hidden later still shows and navigates. Offline, the
 * list is the encrypted device copy, read only (AC-13, Raz ח2). Logs carry a
 * code only.
 */
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { useEffect, useSyncExternalStore } from 'react';

import { readTripCopy, writeTripCopy } from '@/features/trips/tripCopies';
import { tripsCacheGeneration } from '@/features/trips/tripsCache';
import { supabase } from '@/lib/supabase';

import type { Place } from './placesModel';

export interface SavedPlace {
  ref: string;
  name: string;
  lat: number;
  lng: number;
  createdAt: string;
}

export type SavedState =
  | { status: 'loading' }
  | { status: 'ready'; places: SavedPlace[]; fromCache: boolean }
  | { status: 'failed'; offline: boolean };

export type SaveResult = 'ok' | 'offline' | 'consent' | 'gone' | 'limit' | 'error';

/** design 5.2: 15 s, then as offline (timing.trip.saveTimeout). */
const SAVE_TIMEOUT_MS = 15_000;

const states = new Map<string, SavedState>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function log(step: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`[places] ${step} failed`, typeof code === 'string' ? code : 'no code');
}

const online = async () => (await NetInfo.fetch()).isConnected !== false;

/** The trip's saved places, newest first (design 6; at most 100, no paging). */
export async function loadSaved(tripId: string): Promise<void> {
  if (!supabase) return;
  // A sign-out or deletion while this runs: nothing comes back (Raz ח3).
  const startedIn = tripsCacheGeneration();
  const current = () => tripsCacheGeneration() === startedIn;
  if (!states.has(tripId)) {
    states.set(tripId, { status: 'loading' });
    notify();
  }
  const fallBack = async (offline: boolean) => {
    if (states.get(tripId)?.status === 'ready') return notify();
    const copy = await readTripCopy<{ places: SavedPlace[] }>('saved', tripId);
    if (!current()) return;
    states.set(
      tripId,
      copy
        ? { status: 'ready', places: copy.places, fromCache: true }
        : { status: 'failed', offline },
    );
    notify();
  };
  if (!(await online())) return fallBack(true);
  const { data, error } = await supabase
    .from('trip_saved_places')
    .select('place_ref, name, lat, lng, created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    log('load saved', error);
    return fallBack(false);
  }
  if (!current()) return;
  const places = data.map((r) => ({
    ref: r.place_ref as string,
    name: r.name as string,
    lat: r.lat as number,
    lng: r.lng as number,
    createdAt: r.created_at as string,
  }));
  states.set(tripId, { status: 'ready', places, fromCache: false });
  notify();
  await writeTripCopy('saved', tripId, { places }, startedIn);
}

async function call(step: string, fn: string, args: Record<string, unknown>): Promise<SaveResult> {
  if (!supabase) return 'error';
  if (!(await online())) return 'offline';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'timeout'>(
    (r) => (timer = setTimeout(() => r('timeout'), SAVE_TIMEOUT_MS)),
  );
  const answer = await Promise.race([supabase.rpc(fn, args), late]).finally(() =>
    clearTimeout(timer),
  );
  if (answer === 'timeout') return 'offline';
  if (answer.error) {
    const { code, hint } = answer.error as { code?: string; hint?: string };
    if (code === '42501' && hint === 'consent_required') return 'consent';
    log(step, answer.error);
    return 'error';
  }
  const data = answer.data as string;
  return data === 'ok' || data === 'gone' || data === 'limit' ? data : 'error';
}

/** The name the snapshot keeps: the app's language when there is one (D4). */
export const snapshotName = (place: Place, language: string) =>
  (language === 'he' && place.nameHe) || place.nameEn;

/** Save, then read the list again so the count and the icons follow the server. */
export async function savePlace(
  tripId: string,
  place: Place,
  language: string,
): Promise<SaveResult> {
  const result = await call('save place', 'save_place', {
    p_id: randomUUID(),
    p_trip_id: tripId,
    p_place: {
      placeRef: place.ref,
      name: snapshotName(place, language),
      lat: place.lat,
      lng: place.lng,
    },
  });
  if (result === 'ok') await loadSaved(tripId);
  return result;
}

export async function unsavePlace(tripId: string, ref: string): Promise<SaveResult> {
  const result = await call('unsave place', 'unsave_place', {
    p_trip_id: tripId,
    p_place_ref: ref,
  });
  if (result === 'ok' || result === 'gone') {
    const state = states.get(tripId);
    if (state?.status === 'ready') {
      states.set(tripId, { ...state, places: state.places.filter((p) => p.ref !== ref) });
      notify();
    }
    return 'ok';
  }
  return result;
}

const LOADING: SavedState = { status: 'loading' };

/** A trip's saved places; loads them when the screen opens. Null trip: nothing. */
export function useSaved(tripId: string | null): SavedState {
  const state = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => (tripId ? (states.get(tripId) ?? LOADING) : LOADING),
  );
  useEffect(() => {
    if (tripId) void loadSaved(tripId);
  }, [tripId]);
  return state;
}

/** Sign-out and account deletion: nothing of the user stays in memory. */
export function clearSaved() {
  states.clear();
  notify();
}
