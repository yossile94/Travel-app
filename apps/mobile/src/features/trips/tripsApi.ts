/**
 * Trips on the server (sprint 2 F-006, ADR-006 section 4). Every call answers
 * with a named result the screens can show; errors are logged with their code
 * only, never the error object (PostgREST's details hold the user's row).
 */
import NetInfo from '@react-native-community/netinfo';

import { supabase } from '@/lib/supabase';

export interface Trip {
  id: string;
  countryAdm0: string;
  title: string;
  startDate: string;
  endDate: string;
  notes: string | null;
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

const COLUMNS = 'id, country_adm0, title, start_date, end_date, notes';

interface TripRow {
  id: string;
  country_adm0: string;
  title: string;
  start_date: string;
  end_date: string;
  notes: string | null;
}

function fromRow(row: TripRow): Trip {
  return {
    id: row.id,
    countryAdm0: row.country_adm0,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
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
  const trips = (data as TripRow[]).map(fromRow);
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
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '42501') return 'consent';
  logFailure(step, error);
  return 'error';
}

/** Creates a trip with the id made when the form opened: a retry can't make a second one (AC-3). */
export async function createTrip(trip: Trip): Promise<WriteResult> {
  if (!supabase) return 'error';
  if (!(await online())) return 'offline';
  const { error } = await supabase.from('trips').insert({
    id: trip.id,
    country_adm0: trip.countryAdm0,
    title: trip.title,
    start_date: trip.startDate,
    end_date: trip.endDate,
    notes: trip.notes,
  });
  if (!error) return 'ok';
  // The same id again: the earlier attempt was saved and its answer was lost.
  if ((error as { code?: string }).code === '23505') return 'ok';
  return writeFailure('create', error);
}

/** Updates the fields the user may change; the country never changes (AC-2). */
export async function updateTrip(
  id: string,
  fields: Pick<Trip, 'title' | 'startDate' | 'endDate' | 'notes'>,
): Promise<WriteResult> {
  if (!supabase) return 'error';
  if (!(await online())) return 'offline';
  const { data, error } = await supabase
    .from('trips')
    .update({
      title: fields.title,
      start_date: fields.startDate,
      end_date: fields.endDate,
      notes: fields.notes,
    })
    .eq('id', id)
    .select('id');
  if (error) return writeFailure('update', error);
  return data && data.length > 0 ? 'ok' : 'gone';
}

/** Deletes a trip; never gated by consent (AC-9). 'gone' means it was already deleted. */
export async function deleteTrip(id: string): Promise<WriteResult> {
  if (!supabase) return 'error';
  if (!(await online())) return 'offline';
  const { data, error } = await supabase.from('trips').delete().eq('id', id).select('id');
  if (error) return writeFailure('delete', error);
  return data && data.length > 0 ? 'ok' : 'gone';
}
