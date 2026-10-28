/**
 * "Download my data" (sprint 2 AC-14, design 10): every page of the account,
 * profile, trips and consent log, read from the server, written as one JSON
 * file in the cache and handed to the system share sheet. Never a partial
 * file: anything that fails deletes what was written. The file is deleted
 * after the share sheet closes, and leftovers from an interrupted export are
 * swept at launch and before every export.
 */
import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { supabase } from '@/lib/supabase';

import { todayPg } from '../trips/tripDates';
import { ensureProfile } from './accountApi';

const PAGE = 500;
const EXPORT_PREFIX = 'export-';

export type ExportResult = 'shared' | 'offline' | 'error' | 'aborted';

/** Deletes every cache/export-* folder (design 10.5). Best effort. */
export function sweepExports(): void {
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof Directory && entry.name.startsWith(EXPORT_PREFIX)) entry.delete();
    }
  } catch {
    // A sweep that fails now runs again next time.
  }
}

class Aborted extends Error {}

/** Reads a whole table page by page, keyset on id (AC-14: all pages). */
async function readAll<T extends { id: string | number }>(
  table: 'trips' | 'consents' | 'push_tokens',
  columns: string,
  userId: string,
  signal: AbortSignal,
): Promise<T[]> {
  const rows: T[] = [];
  let last: string | number | null = null;
  for (;;) {
    if (signal.aborted) throw new Aborted();
    // The user filter besides RLS lets the planner use the (user_id, …) indexes (review).
    let query = supabase!
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .limit(PAGE);
    if (last !== null) query = query.gt('id', last);
    const { data, error } = await query;
    if (error || !data) throw error ?? new Error('no data');
    const page = data as unknown as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
    last = page[page.length - 1]!.id;
  }
}

/** Builds the export document; exported for tests. */
export async function buildExport(
  user: { id: string; name: string | null; email: string | null },
  signal: AbortSignal,
): Promise<object> {
  if (!supabase) throw new Error('Supabase is not configured');
  // Design 10.8: a missing profile is created first; still missing → null.
  await ensureProfile(user.id, user.name, user.email);
  if (signal.aborted) throw new Aborted();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw authError ?? new Error('no user');
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    // Sprint 6: the flight alerts switch (Dudi 4).
    .select('display_name, flight_alerts, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  const trips = await readAll<{ id: string }>(
    'trips',
    // Sprint 3: each trip with its travelers and cities (AC-3, AC-5); sprint 5: its flights.
    'id, country_adm0, title, start_date, end_date, notes, created_at, updated_at, ' +
      'trip_travelers(name, relation, position), trip_cities(geoname_id, name, position), ' +
      // Sprint 5 AC-3: every flight field the user saved, booking code and seat included.
      'flights(direction, flight_number_input, flight_number, dep_date_local, airline_name, ' +
      'dep_iata, dep_tz, arr_iata, arr_tz, dep_sched, arr_sched, dep_terminal, dep_gate, ' +
      'arr_terminal, pnr, seat, cabin, same_booking, created_at, updated_at), ' +
      // Sprint 8 (Dudi 2): hotels and insurance, booking and policy numbers included.
      'hotels(name, address_en, address_local, phone, check_in, check_out, booking_ref, created_at, updated_at), ' +
      'insurance(provider, policy_number, valid_until, emergency_phone, notes, created_at, updated_at)',
    user.id,
    signal,
  );
  const consents = await readAll<{ id: number }>(
    'consents',
    'id, doc_type, doc_version, action, platform, app_version, created_at',
    user.id,
    signal,
  );
  // Sprint 6 (Dudi 4): the devices that get alerts; the token itself is a device secret, left out.
  const devices = await readAll<{ id: number }>(
    'push_tokens',
    'id, platform, locale, created_at, last_seen_at',
    user.id,
    signal,
  );
  return {
    format: 'travel-app-export',
    version: 1,
    exported_at: new Date().toISOString(),
    account: {
      email: auth.user.email ?? null,
      sign_in_provider:
        (auth.user.app_metadata as { provider?: string } | undefined)?.provider ?? null,
      created_at: auth.user.created_at,
    },
    profile: profile ?? null,
    trips,
    // The log row ids are internal; the rows themselves are the record.
    consents: consents.map(({ id: _id, ...row }) => row),
    alert_devices: devices.map(({ id: _id, ...row }) => row),
  };
}

export async function exportMyData(
  user: { id: string; name: string | null; email: string | null },
  dialogTitle: string,
  signal: AbortSignal,
): Promise<ExportResult> {
  const net = await NetInfo.fetch();
  if (net.isConnected === false) return 'offline';
  sweepExports();
  let folder: Directory | null = null;
  try {
    const document = await buildExport(user, signal);
    if (signal.aborted) return 'aborted';
    folder = new Directory(Paths.cache, `${EXPORT_PREFIX}${Date.now()}`);
    folder.create();
    // travel-data-YYYY-MM-DD.json, the device's local date (design 19.6).
    const file = new File(folder, `travel-data-${todayPg()}.json`);
    file.create();
    await file.write(JSON.stringify(document, null, 2));
    if (signal.aborted) return 'aborted';
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle });
    return 'shared';
  } catch (error) {
    if (error instanceof Aborted) return 'aborted';
    const code = (error as { code?: unknown } | null)?.code;
    console.error('[account] export failed', typeof code === 'string' ? code : 'no code');
    return 'error';
  } finally {
    try {
      if (folder?.exists) folder.delete();
    } catch {
      // Swept at the next launch or export.
    }
  }
}
