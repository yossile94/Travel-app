/**
 * Sprint 11 F-029 (ADR-016 2, D22; Raz design approval 8): a country's places
 * on the device. The Wikidata list is read in pages of 500 — the API returns
 * at most 1,000 rows a request — in a stable order, and kept per country in a
 * plain device copy (not personal, like the rates). It is read again only when
 * the copy is over 7 days old or the data version changed. The curated places
 * are a small query, read on every first opening in a session.
 *
 * At most one download per country per session (design 7).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';

import { mergeCurated, type CuratedCategory, type Place } from './placesModel';

/** Bumped with every new places data migration (scripts/build-places.mjs). */
export const PLACES_DATA_VERSION = 1;
const PAGE = 500;
/** D22: the build fails above this, so a country never needs more pages. */
const MAX_PAGES = 3;
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const key = (adm0: string) => `places.v1.${adm0}`;

interface Stored {
  version: number;
  savedAt: string;
  wikidata: Place[];
  curated: Place[];
}

export type PlacesState =
  | { status: 'loading' }
  | { status: 'ready'; places: Place[]; savedAt: string; fromDevice: boolean }
  /** Nothing on the device, and the read failed: offline or an error. */
  | { status: 'failed' };

const states = new Map<string, PlacesState>();
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();
const notify = () => listeners.forEach((l) => l());

const fromRow = (r: Record<string, unknown>): Place => ({
  ref: `wd:${r.wikidata_id as string}`,
  nameHe: (r.name_he as string | null) ?? null,
  nameEn: r.name_en as string,
  lat: r.lat as number,
  lng: r.lng as number,
  category: r.category as CuratedCategory,
  popularity: r.popularity as number,
});

const fromCurated = (r: Record<string, unknown>): Place => ({
  ref: `cu:${r.id as string}`,
  nameHe: r.name_he as string,
  nameEn: r.name_en as string,
  lat: r.lat as number,
  lng: r.lng as number,
  category: r.category as CuratedCategory,
  popularity: 0,
  curated: {
    body: (r.body as string | null) ?? null,
    sourceUrl: r.source_url as string,
    verifiedAt: r.verified_at as string,
    wikidataQid: (r.wikidata_qid as string | null) ?? null,
  },
});

async function readWikidata(adm0: string): Promise<Place[] | null> {
  if (!supabase) return null;
  const rows: Place[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from('places')
      .select('wikidata_id, name_he, name_en, lat, lng, category, popularity')
      .eq('adm0', adm0)
      .order('popularity', { ascending: false })
      .order('wikidata_id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      console.warn('[places] read failed', error.code);
      return null;
    }
    rows.push(...data.map(fromRow));
    if (data.length < PAGE) break;
  }
  return rows;
}

async function readCurated(adm0: string): Promise<Place[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('curated_places')
    .select('id, category, name_he, name_en, body, lat, lng, source_url, verified_at, wikidata_qid')
    .eq('adm0', adm0)
    .eq('status', 'published');
  if (error) {
    console.warn('[places] curated read failed', error.code);
    return null;
  }
  return data.map(fromCurated);
}

async function readDevice(adm0: string): Promise<Stored | null> {
  try {
    const text = await AsyncStorage.getItem(key(adm0));
    const stored = text ? (JSON.parse(text) as Stored) : null;
    return stored && Array.isArray(stored.wikidata) ? stored : null;
  } catch {
    return null;
  }
}

function publish(adm0: string, stored: Stored, fromDevice: boolean) {
  states.set(adm0, {
    status: 'ready',
    places: mergeCurated(stored.wikidata, stored.curated),
    savedAt: stored.savedAt,
    fromDevice,
  });
  notify();
}

/**
 * The device copy at once; then, once a session, the curated places, and the
 * Wikidata list when the copy is old or of another version. A failed read
 * keeps the copy, with no message (design 7).
 */
export function loadPlaces(adm0: string, now = Date.now()): Promise<void> {
  const running = loading.get(adm0);
  if (running) return running;
  const job = (async () => {
    if (!states.has(adm0)) {
      states.set(adm0, { status: 'loading' });
      notify();
    }
    const device = await readDevice(adm0);
    if (device) publish(adm0, device, true);
    // An empty list is never fresh: the country's places may have come since
    // (sprint 12 device check: Japan stayed empty for a week after the load).
    const fresh =
      device &&
      device.version === PLACES_DATA_VERSION &&
      device.wikidata.length > 0 &&
      now - Date.parse(device.savedAt) < REFRESH_MS;
    const [wikidata, curated] = await Promise.all([
      fresh ? Promise.resolve(device.wikidata) : readWikidata(adm0).catch(() => null),
      readCurated(adm0).catch(() => null),
    ]);
    if (!wikidata || !curated) {
      if (!device) {
        states.set(adm0, { status: 'failed' });
        notify();
        // A later opening tries again.
        loading.delete(adm0);
      }
      return;
    }
    const stored: Stored = {
      version: PLACES_DATA_VERSION,
      savedAt: fresh ? device.savedAt : new Date(now).toISOString(),
      wikidata,
      curated,
    };
    publish(adm0, stored, false);
    await AsyncStorage.setItem(key(adm0), JSON.stringify(stored)).catch(() => {});
  })();
  loading.set(adm0, job);
  return job;
}

/** Try again after a failure ("נסו שוב"). */
export function retryPlaces(adm0: string): Promise<void> {
  loading.delete(adm0);
  states.delete(adm0);
  return loadPlaces(adm0);
}

const LOADING: PlacesState = { status: 'loading' };

/** A country's places for the screen; loads them once a session. */
export function usePlaces(adm0: string): PlacesState {
  const state = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => states.get(adm0) ?? LOADING,
  );
  useEffect(() => {
    void loadPlaces(adm0);
  }, [adm0]);
  return state;
}

/**
 * Design 7: in the background, the countries of the active and upcoming trips,
 * when the trips load with a network — so the list is there at the airport.
 */
export function prefetchPlaces(adm0s: Iterable<string>): void {
  for (const adm0 of new Set(adm0s)) void loadPlaces(adm0);
}

/** Tests only. */
export function resetPlacesForTests() {
  states.clear();
  loading.clear();
}
