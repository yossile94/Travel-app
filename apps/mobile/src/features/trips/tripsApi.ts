/**
 * Trips on the server (sprint 2 F-006, ADR-006 section 4). Every call answers
 * with a named result the screens can show; errors are logged with their code
 * only, never the error object (PostgREST's details hold the user's row).
 */
import NetInfo from '@react-native-community/netinfo';

import { supabase } from '@/lib/supabase';

/** How a traveler is related to the user (sprint 3 AC-1); the labels are translated. */
export type TravelerRelation = 'partner' | 'child' | 'parent' | 'friend' | 'other';

/** A traveler without an account (sprint 3 AC-1). "Me" is implicit, never stored. */
export interface TripTraveler {
  name: string;
  relation: TravelerRelation | null;
}

/** A city of the trip (sprint 3 AC-4): from the bundled list, or typed in (no id). */
export interface TripCity {
  geonameId: number | null;
  name: string;
}

export interface Trip {
  id: string;
  countryAdm0: string;
  title: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  /** In order, at most 9. */
  travelers: TripTraveler[];
  /** In order, at most 10; the same city may appear twice. */
  cities: TripCity[];
}

export type TripSection = 'upcoming' | 'past';

/** Where the next page starts: the last row shown (keyset on start date, then id). */
export interface TripCursor {
  startDate: string;
  id: string;
}

export interface TripPage {
  trips: Trip[];
  next: TripCursor | null;
}

export type LoadResult<T> = { ok: true; value: T } | { ok: false; reason: 'offline' | 'error' };

/** What a write ended as: saved, or why not. */
export type WriteResult =
  | 'ok'
  | 'offline'
  /** 42501 from the consent gate: the updated terms must be accepted first (AC-9). */
  | 'consent'
  /** No row matched: deleted on another device (AC-6). */
  | 'gone'
  | 'error';

export const TRIPS_PAGE_SIZE = 20;

// The travelers and cities come in the same request (sprint 3 AC-3: no request per row).
const COLUMNS =
  'id, country_adm0, title, start_date, end_date, notes, ' +
  'trip_travelers(name, relation, position), trip_cities(geoname_id, name, position)';

interface TripRow {
  id: string;
  country_adm0: string;
  title: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  trip_travelers?: { name: string; relation: TravelerRelation | null; position: number }[] | null;
  trip_cities?: { geoname_id: number | null; name: string; position: number }[] | null;
}

/** Embedded rows come in no guaranteed order; position decides (Dudi). */
const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

function fromRow(row: TripRow): Trip {
  return {
    id: row.id,
    countryAdm0: row.country_adm0,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
    travelers: [...(row.trip_travelers ?? [])]
      .sort(byPosition)
      .map(({ name, relation }) => ({ name, relation })),
    cities: [...(row.trip_cities ?? [])]
      .sort(byPosition)
      .map(({ geoname_id, name }) => ({ geonameId: geoname_id, name })),
  };
}

function logFailure(step: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`[trips] ${step} failed`, typeof code === 'string' ? code : 'no code');
}

async function online(): Promise<boolean> {
  const net = await NetInfo.fetch();
  return net.isConnected !== false;
}

/**
 * One page of a section, in the order of AC-5: upcoming by departure (soonest
 * first), past by departure (latest first); id breaks ties. `today` is the
 * device's local date. With `countryAdm0`, only that country's trips (AC-4).
 */
export async function loadTripPage({
  section,
  today,
  cursor = null,
  countryAdm0,
  pageSize = TRIPS_PAGE_SIZE,
}: {
  section: TripSection;
  today: string;
  cursor?: TripCursor | null;
  countryAdm0?: string;
  pageSize?: number;
}): Promise<LoadResult<TripPage>> {
  if (!supabase) return { ok: false, reason: 'error' };
  if (!(await online())) return { ok: false, reason: 'offline' };
  const upcoming = section === 'upcoming';
  let query = supabase.from('trips').select(COLUMNS);
  query = upcoming ? query.gte('end_date', today) : query.lt('end_date', today);
  if (countryAdm0) query = query.eq('country_adm0', countryAdm0);
  if (cursor) {
    const op = upcoming ? 'gt' : 'lt';
    query = query.or(
      `start_date.${op}.${cursor.startDate},and(start_date.eq.${cursor.startDate},id.${op}.${cursor.id})`,
    );
  }
  const { data, error } = await query
    .order('start_date', { ascending: upcoming })
    .order('id', { ascending: upcoming })
    .limit(pageSize);
  if (error || !data) {
    logFailure(`load ${section}`, error);
    return { ok: false, reason: 'error' };
  }
  const trips = (data as unknown as TripRow[]).map(fromRow);
  const last = trips.at(-1);
  return {
    ok: true,
    value: {
      trips,
      next: trips.length === pageSize && last ? { startDate: last.startDate, id: last.id } : null,
    },
  };
}

/** The countries the user has trips to, for the globe highlight (AC-10): one query. */
export async function loadTripCountries(): Promise<LoadResult<Set<string>>> {
  if (!supabase) return { ok: false, reason: 'error' };
  if (!(await online())) return { ok: false, reason: 'offline' };
  const { data, error } = await supabase.rpc('my_trip_countries');
  if (error || !Array.isArray(data)) {
    logFailure('countries', error);
    return { ok: false, reason: 'error' };
  }
  return { ok: true, value: new Set(data as string[]) };
}

function writeFailure(step: string, error: unknown): WriteResult {
  const { code, hint } = (error ?? {}) as { code?: unknown; hint?: unknown };
  // Only the consent gate's own refusal opens the consent screen; a 42501
  // from a missing grant is a bug, not a consent question (ADR-007).
  if (code === '42501' && hint === 'consent_required') return 'consent';
  logFailure(step, error);
  return 'error';
}

/**
 * Saves a whole trip, its travelers and cities, in one transaction
 * (save_trip, ADR-007). A create uses the id made when the form opened, so a
 * retry after a lost answer can't make a second trip (AC-3 of sprint 2);
 * an update of a trip deleted elsewhere answers 'gone' (AC-6 of sprint 2).
 * The country never changes after creation.
 */
export async function saveTrip(mode: 'create' | 'update', trip: Trip): Promise<WriteResult> {
  if (!supabase) return 'error';
  if (!(await online())) return 'offline';
  const { data, error } = await supabase.rpc('save_trip', {
    p_mode: mode,
    p_id: trip.id,
    p_country_adm0: trip.countryAdm0,
    p_title: trip.title,
    p_start: trip.startDate,
    p_end: trip.endDate,
    p_notes: trip.notes,
    p_travelers: trip.travelers.map(({ name, relation }) => ({ name, relation })),
    p_cities: trip.cities.map(({ geonameId, name }) => ({ geonameId, name })),
  });
  if (error) return writeFailure(mode, error);
  return data === 'gone'
    ? 'gone'
    : data === 'ok'
      ? 'ok'
      : writeFailure(mode, { code: 'unexpected' });
}

/** Deletes a trip; never gated by consent (AC-9). 'gone' means it was already deleted. */
export async function deleteTrip(id: string): Promise<WriteResult> {
  if (!supabase) return 'error';
  if (!(await online())) return 'offline';
  const { data, error } = await supabase.from('trips').delete().eq('id', id).select('id');
  if (error) return writeFailure('delete', error);
  return data && data.length > 0 ? 'ok' : 'gone';
}
