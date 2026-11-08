/**
 * Sprint 14 F-043: the hotel search, through the `places` Edge Function (the
 * Google key never reaches the app). Like flightsApi: every call answers with
 * a named result, and nothing the user typed is logged.
 *
 * AC-5 (Raz, design approval 1): the answer's body decides, not the status.
 *   'unavailable' — the server has no key: the field hides until restart.
 *   'quota'       — the user's day or the project's month is used up.
 *   'failed'      — anything else (a gateway 5xx, a timeout, Google down):
 *                   "not available right now", and the next keystroke tries again.
 *   'offline'     — the device says so: the field hides.
 */
import NetInfo from '@react-native-community/netinfo';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/** 8 seconds, then "not available right now" (design 1.4). */
const PLACES_TIMEOUT_MS = 8_000;

export type Suggestion = { placeId: string; name: string; place: string };

export type PickedPlace = {
  placeId: string;
  nameLocal: string | null;
  addressLocal: string | null;
  nameEn: string | null;
  addressEn: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  fetchedAt: string;
};

export type Refreshed = { placeId: string; lat: number; lng: number; fetchedAt: string };

type Failure = { kind: 'unavailable' | 'quota' | 'failed' | 'offline' };
export type SearchResult = { kind: 'ok'; suggestions: Suggestion[] } | Failure;
export type PickResult = { kind: 'ok'; place: PickedPlace } | { kind: 'gone' } | Failure;
export type RefreshResult = { kind: 'ok'; refreshed: Refreshed } | { kind: 'gone' } | Failure;

/** The function's answer as the form reads it; exported for tests. */
export function placesFrom(
  status: number,
  body: unknown,
): { kind: 'ok'; body: Record<string, unknown> } | { kind: 'gone' } | Failure {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (status === 200 && b.gone === true) return { kind: 'gone' };
  if (status === 200) return { kind: 'ok', body: b };
  if (b.error === 'unavailable') return { kind: 'unavailable' };
  if (b.error === 'quota') return { kind: 'quota' };
  return { kind: 'failed' };
}

async function call(body: Record<string, unknown>) {
  if (!supabase) return { kind: 'unavailable' } as const;
  if ((await NetInfo.fetch()).isConnected === false) return { kind: 'offline' } as const;
  const request = supabase.functions
    .invoke('places', { body, timeout: PLACES_TIMEOUT_MS })
    .then(async ({ data, error }) => {
      if (!error) return placesFrom(200, data);
      if (error instanceof FunctionsHttpError) {
        const response = error.context as Response;
        let parsed: unknown = null;
        try {
          parsed = await response.json();
        } catch {
          // Outside the contract: a gateway error, "failed".
        }
        return placesFrom(response.status, parsed);
      }
      return { kind: 'failed' } as const;
    })
    .catch(() => ({ kind: 'failed' }) as const);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ kind: 'failed' }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'failed' }), PLACES_TIMEOUT_MS + 1000);
  });
  return Promise.race([request, late]).finally(() => clearTimeout(timer));
}

export async function searchHotels(q: {
  input: string;
  session: string;
  regions: string[];
  language: string;
}): Promise<SearchResult> {
  const r = await call({ mode: 'search', ...q });
  if (r.kind === 'gone') return { kind: 'failed' };
  if (r.kind !== 'ok') return r;
  const list = Array.isArray(r.body.suggestions) ? (r.body.suggestions as Suggestion[]) : [];
  return { kind: 'ok', suggestions: list.slice(0, 5) };
}

export async function pickHotel(q: {
  placeId: string;
  session: string;
  localLanguage: string;
}): Promise<PickResult> {
  const r = await call({ mode: 'pick', ...q });
  if (r.kind !== 'ok') return r;
  const place = r.body.place as PickedPlace | undefined;
  return place ? { kind: 'ok', place } : { kind: 'failed' };
}

export async function refreshHotelPoint(placeId: string): Promise<RefreshResult> {
  const r = await call({ mode: 'refresh', placeId });
  if (r.kind !== 'ok') return r;
  const refreshed = r.body.refreshed as Refreshed | undefined;
  return refreshed ? { kind: 'ok', refreshed } : { kind: 'failed' };
}
