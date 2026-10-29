/**
 * Hotels and insurance on the server (sprint 8 F-020, F-021). Like
 * flightsApi: every call answers with a named result, and logs carry a code
 * only, never a name, address, booking or policy number (AC-6).
 */
import NetInfo from '@react-native-community/netinfo';

import { supabase } from '@/lib/supabase';

import type { Hotel, hotelPayload, Insurance, insurancePayload } from './kitModel';

export type KitWrite = 'ok' | 'offline' | 'consent' | 'gone' | 'limit' | 'dates' | 'error';

/** design 4.4: 15 s, then as offline. */
const SAVE_TIMEOUT_MS = 15_000;

function log(step: string, error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`[kit] ${step} failed`, typeof code === 'string' ? code : 'no code');
}

async function online(): Promise<boolean> {
  return (await NetInfo.fetch()).isConnected !== false;
}

interface HotelRow {
  id: string;
  trip_id: string;
  name: string;
  address_en: string;
  address_local: string | null;
  phone: string | null;
  check_in: string;
  check_out: string;
  booking_ref: string | null;
  lat?: number | null;
  lng?: number | null;
}

interface InsuranceRow {
  trip_id: string;
  provider: string;
  policy_number: string | null;
  valid_until: string | null;
  emergency_phone: string | null;
  notes: string | null;
}

export const hotelFromRow = (r: HotelRow): Hotel => ({
  id: r.id,
  tripId: r.trip_id,
  name: r.name,
  addressEn: r.address_en,
  addressLocal: r.address_local,
  phone: r.phone,
  checkIn: r.check_in,
  checkOut: r.check_out,
  bookingRef: r.booking_ref,
  point:
    r.lat !== null && r.lat !== undefined && r.lng !== null && r.lng !== undefined
      ? [r.lng, r.lat]
      : null,
});

export const insuranceFromRow = (r: InsuranceRow): Insurance => ({
  tripId: r.trip_id,
  provider: r.provider,
  policyNumber: r.policy_number,
  validUntil: r.valid_until,
  emergencyPhone: r.emergency_phone,
  notes: r.notes,
});

export interface Kit {
  hotels: Hotel[];
  insurance: Insurance[];
}

/** The hotels and insurance of up to 50 trips: two reads, never one per trip. */
export async function loadKit(
  tripIds: string[],
): Promise<{ ok: true; value: Kit } | { ok: false; reason: 'offline' | 'error' }> {
  if (!supabase) return { ok: false, reason: 'error' };
  const ids = tripIds.slice(0, 50);
  if (ids.length === 0) return { ok: true, value: { hotels: [], insurance: [] } };
  if (!(await online())) return { ok: false, reason: 'offline' };
  const [hotels, insurance] = await Promise.all([
    supabase
      .from('hotels')
      .select(
        'id, trip_id, name, address_en, address_local, phone, check_in, check_out, booking_ref, lat, lng',
      )
      .in('trip_id', ids)
      .order('check_in')
      .limit(ids.length * 10),
    supabase
      .from('insurance')
      .select('trip_id, provider, policy_number, valid_until, emergency_phone, notes')
      .in('trip_id', ids)
      .limit(ids.length),
  ]);
  if (hotels.error || insurance.error) {
    log('load', hotels.error ?? insurance.error);
    return { ok: false, reason: 'error' };
  }
  return {
    ok: true,
    value: {
      hotels: (hotels.data as HotelRow[]).map(hotelFromRow),
      insurance: (insurance.data as InsuranceRow[]).map(insuranceFromRow),
    },
  };
}

async function call(step: string, fn: string, args: Record<string, unknown>): Promise<KitWrite> {
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
  return data === 'ok' || data === 'gone' || data === 'limit' || data === 'dates' ? data : 'error';
}

/** One hotel, with the id made when the screen opened (a retry writes the same row). */
export const saveHotel = (id: string, tripId: string, hotel: ReturnType<typeof hotelPayload>) =>
  call('save hotel', 'save_hotel', { p_id: id, p_trip_id: tripId, p_hotel: hotel });

/** Never gated by consent. 'gone': already deleted. */
export const deleteHotel = (id: string) => call('delete hotel', 'delete_hotel', { p_id: id });

export const saveInsurance = (tripId: string, insurance: ReturnType<typeof insurancePayload>) =>
  call('save insurance', 'save_insurance', { p_trip_id: tripId, p_insurance: insurance });

export const deleteInsurance = (tripId: string) =>
  call('delete insurance', 'delete_insurance', { p_trip_id: tripId });
