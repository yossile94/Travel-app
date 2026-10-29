/**
 * Sprint 11 F-030, F-031 (AC-12, AC-13; D2, D3; ADR-009): a trip's board on
 * the server and on the device. Reads from itinerary_items; writes only
 * through the RPCs (consent gate, limits, the trip's lock), never
 * optimistically — each write reads the trip's items again. Offline, the
 * board shows the encrypted device copy, read only. The copy shares the trips
 * cache's prefix, so every way out (sign-out, deletion) removes it too.
 * Logs carry a code only, never a title or a note.
 */
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useSyncExternalStore } from 'react';

import { secureSessionStorage } from '@/lib/secureSessionStorage';
import { supabase } from '@/lib/supabase';

import type { Item } from './itineraryModel';

export type BoardState =
  | { status: 'loading' }
  | { status: 'ready'; items: Item[]; fromCache: boolean; savedAt: string }
  | { status: 'failed'; offline: boolean };

export type BoardWrite = 'ok' | 'offline' | 'consent' | 'gone' | 'limit' | 'day' | 'error';

/** design 11.2: 15 s, then as offline. */
const WRITE_TIMEOUT_MS = 15_000;
/** Raz ח5: the active trip and the next 5 keep a copy. */
export const CACHED_TRIPS = 6;

const states = new Map<string, BoardState>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const cacheKey = (tripId: string) => `trips-cache.itinerary.${tripId}`;

function log(step: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`[itinerary] ${step} failed`, typeof code === 'string' ? code : 'no code');
}

const online = async () => (await NetInfo.fetch()).isConnected !== false;

const fromRow = (r: Record<string, unknown>): Item => ({
  id: r.id as string,
  tripId: r.trip_id as string,
  day: r.day_date as string,
  time: r.time_of_day ? (r.time_of_day as string).slice(0, 5) : null,
  title: r.title as string,
  note: (r.note as string | null) ?? null,
  placeRef: (r.place_ref as string | null) ?? null,
  placeName: (r.place_name as string | null) ?? null,
  lat: (r.lat as number | null) ?? null,
  lng: (r.lng as number | null) ?? null,
  source: r.source as Item['source'],
  sortOrder: r.sort_order as number,
});

async function readCopy(tripId: string): Promise<{ items: Item[]; savedAt: string } | null> {
  try {
    const text = await secureSessionStorage.getItem(cacheKey(tripId));
    return text ? (JSON.parse(text) as { items: Item[]; savedAt: string }) : null;
  } catch {
    return null;
  }
}

/** Whether this trip keeps a device copy (the active one and the next 5). */
const keepCopy = new Set<string>();
export function setCachedTrips(tripIds: readonly string[]) {
  keepCopy.clear();
  for (const id of tripIds.slice(0, CACHED_TRIPS)) keepCopy.add(id);
}

/** The trip's items: the server's, or the device copy offline (read only). */
export async function loadBoard(tripId: string): Promise<void> {
  if (!states.has(tripId)) {
    states.set(tripId, { status: 'loading' });
    notify();
  }
  const fallBack = async (offline: boolean) => {
    const copy = await readCopy(tripId);
    states.set(
      tripId,
      copy
        ? { status: 'ready', items: copy.items, fromCache: true, savedAt: copy.savedAt }
        : { status: 'failed', offline },
    );
    notify();
  };
  if (!supabase || !(await online())) return fallBack(true);
  const { data, error } = await supabase
    .from('itinerary_items')
    .select(
      'id, trip_id, day_date, time_of_day, title, note, place_ref, place_name, lat, lng, source, sort_order',
    )
    .eq('trip_id', tripId)
    .order('day_date')
    .order('sort_order')
    .limit(600);
  if (error) {
    log('load', error);
    return fallBack(false);
  }
  const items = data.map(fromRow);
  const savedAt = new Date().toISOString();
  states.set(tripId, { status: 'ready', items, fromCache: false, savedAt });
  notify();
  if (keepCopy.has(tripId)) {
    await secureSessionStorage
      .setItem(cacheKey(tripId), JSON.stringify({ items, savedAt }))
      .catch((e: unknown) => console.warn('[itinerary] cache write failed', (e as Error)?.name));
  }
}

async function rpc<T>(
  step: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; result: BoardWrite }> {
  if (!supabase) return { ok: false, result: 'error' };
  if (!(await online())) return { ok: false, result: 'offline' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'timeout'>(
    (r) => (timer = setTimeout(() => r('timeout'), WRITE_TIMEOUT_MS)),
  );
  const answer = await Promise.race([supabase.rpc(fn, args), late]).finally(() =>
    clearTimeout(timer),
  );
  if (answer === 'timeout') return { ok: false, result: 'offline' };
  if (answer.error) {
    const { code, hint } = answer.error as { code?: string; hint?: string };
    if (code === '42501' && hint === 'consent_required') return { ok: false, result: 'consent' };
    log(step, answer.error);
    return { ok: false, result: 'error' };
  }
  return { ok: true, data: answer.data as T };
}

const asWrite = (data: unknown): BoardWrite =>
  data === 'ok' || data === 'gone' || data === 'limit' || data === 'day' ? data : 'error';

/** One item, new or changed, a day change included (Raz design approval 2-3). */
export async function saveItem(
  tripId: string,
  id: string,
  item: Pick<Item, 'day' | 'time' | 'title' | 'note' | 'placeRef' | 'placeName' | 'lat' | 'lng'>,
): Promise<BoardWrite> {
  const answer = await rpc<string>('save item', 'save_itinerary_item', {
    p_id: id,
    p_trip_id: tripId,
    p_item: {
      day: item.day,
      time: item.time ?? '',
      title: item.title,
      note: item.note ?? '',
      placeRef: item.placeRef ?? '',
      placeName: item.placeName ?? '',
      lat: item.lat,
      lng: item.lng,
    },
  });
  const result = answer.ok ? asWrite(answer.data) : answer.result;
  if (result === 'ok') await loadBoard(tripId);
  return result;
}

/** To a day and a position (0 = first); the day is renumbered on the server. */
export async function moveItem(
  tripId: string,
  id: string,
  day: string,
  position: number,
): Promise<BoardWrite> {
  const answer = await rpc<string>('move item', 'move_itinerary_item', {
    p_id: id,
    p_day: day,
    p_position: position,
  });
  const result = answer.ok ? asWrite(answer.data) : answer.result;
  if (result === 'ok') await loadBoard(tripId);
  return result;
}

export async function deleteItem(tripId: string, id: string): Promise<BoardWrite> {
  const answer = await rpc<string>('delete item', 'delete_itinerary_item', { p_id: id });
  const result = answer.ok ? (answer.data === 'gone' ? 'ok' : asWrite(answer.data)) : answer.result;
  if (result === 'ok') await loadBoard(tripId);
  return result;
}

export interface PlannedOut {
  id: string;
  day: string;
  time: string;
  title: string;
  placeRef: string | null;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  order: number;
}

export type ApplyResult =
  | {
      result: 'ok';
      inserted: number;
      skipped: { date: string; reason: 'filled_meanwhile' | 'out_of_range' }[];
    }
  | { result: 'limit' | 'gone' | 'offline' | 'consent' | 'error' };

/** D2: atomic; only days still empty on the server get items. */
export async function applyPlan(
  tripId: string,
  items: readonly PlannedOut[],
): Promise<ApplyResult> {
  const answer = await rpc<Record<string, unknown>>('apply plan', 'apply_auto_plan', {
    p_trip_id: tripId,
    p_items: items,
  });
  if (!answer.ok)
    return {
      result: answer.result === 'day' || answer.result === 'limit' ? 'error' : answer.result,
    } as ApplyResult;
  const data = answer.data;
  if (data.result === 'ok') {
    await loadBoard(tripId);
    return {
      result: 'ok',
      inserted: data.inserted as number,
      skipped:
        (data.skipped as { date: string; reason: 'filled_meanwhile' | 'out_of_range' }[]) ?? [],
    };
  }
  return { result: data.result === 'limit' || data.result === 'gone' ? data.result : 'error' };
}

const LOADING: BoardState = { status: 'loading' };

export function useBoard(tripId: string | null): BoardState {
  const state = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => (tripId ? (states.get(tripId) ?? LOADING) : LOADING),
  );
  useEffect(() => {
    if (tripId) void loadBoard(tripId);
  }, [tripId]);
  return state;
}

/** Sign-out and deletion: the memory goes (the device copies go with the trips cache). */
export function clearBoards() {
  states.clear();
  keepCopy.clear();
  notify();
}
