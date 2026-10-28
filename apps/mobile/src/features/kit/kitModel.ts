/**
 * The travel kit's hotels and insurance (sprint 8 F-020, F-021): the shapes
 * the server returns and the pure rules the screens and tests share.
 */
import { addDays, codePointLength } from '@/features/trips/tripDates';

import { normalizePhone } from './phone';

export interface Hotel {
  id: string;
  tripId: string;
  name: string;
  addressEn: string;
  addressLocal: string | null;
  /** E.164. */
  phone: string | null;
  checkIn: string;
  checkOut: string;
  bookingRef: string | null;
}

export interface Insurance {
  tripId: string;
  provider: string;
  policyNumber: string | null;
  validUntil: string | null;
  /** E.164. */
  emergencyPhone: string | null;
  notes: string | null;
}

export const HOTELS_PER_TRIP = 10;
export const LIMITS = {
  hotelName: 80,
  address: 200,
  ref: 40,
  provider: 80,
  notes: 300,
} as const;

/** AC-2: by check-in, then by name. */
export const byCheckIn = (hotels: readonly Hotel[]): Hotel[] =>
  [...hotels].sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.name.localeCompare(b.name));

/** Whole nights between two Postgres dates. */
export function nights(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
}

/** Design 3.2: the hotel whose stay today falls in (check-in ≤ today < check-out). */
export const isNowHotel = (h: Hotel, today: string) => h.checkIn <= today && today < h.checkOut;

/** Design 4.2: new hotels start after the last one, until the trip's end; empty if no room. */
export function hotelDefaults(
  hotels: readonly Hotel[],
  trip: { startDate: string; endDate: string },
): { checkIn: string | null; checkOut: string | null } {
  const from = hotels.length
    ? hotels.reduce((m, h) => (h.checkOut > m ? h.checkOut : m), hotels[0]!.checkOut)
    : trip.startDate;
  return from >= trip.endDate
    ? { checkIn: null, checkOut: null }
    : { checkIn: from, checkOut: trip.endDate };
}

export interface HotelForm {
  name: string;
  addressEn: string;
  addressLocal: string;
  phone: string;
  checkIn: string | null;
  checkOut: string | null;
  bookingRef: string;
}

export type HotelField =
  'name' | 'addressEn' | 'addressLocal' | 'phone' | 'checkIn' | 'checkOut' | 'bookingRef';
export const HOTEL_FIELDS: readonly HotelField[] = [
  'name',
  'addressEn',
  'addressLocal',
  'phone',
  'checkIn',
  'checkOut',
  'bookingRef',
];

/** Error kinds per field; the screen turns them into words (design 4.3). */
export type HotelError = 'required' | 'tooLong' | 'phone' | 'outsideTrip' | 'order';

export function hotelErrors(
  v: HotelForm,
  trip: { startDate: string; endDate: string },
): Partial<Record<HotelField, HotelError>> {
  const e: Partial<Record<HotelField, HotelError>> = {};
  const name = v.name.trim();
  if (!name) e.name = 'required';
  else if (codePointLength(name) > LIMITS.hotelName) e.name = 'tooLong';
  const en = v.addressEn.trim();
  if (!en) e.addressEn = 'required';
  else if (codePointLength(en) > LIMITS.address) e.addressEn = 'tooLong';
  if (codePointLength(v.addressLocal.trim()) > LIMITS.address) e.addressLocal = 'tooLong';
  if (v.phone.trim() && !normalizePhone(v.phone)) e.phone = 'phone';
  const inside = (d: string) => d >= trip.startDate && d <= trip.endDate;
  if (!v.checkIn) e.checkIn = 'required';
  else if (!inside(v.checkIn)) e.checkIn = 'outsideTrip';
  if (!v.checkOut) e.checkOut = 'required';
  else if (!inside(v.checkOut)) e.checkOut = 'outsideTrip';
  else if (v.checkIn && v.checkOut <= v.checkIn) e.checkOut = 'order';
  if (codePointLength(v.bookingRef.trim()) > LIMITS.ref) e.bookingRef = 'tooLong';
  return e;
}

/** Bidi controls never reach the server (its text_is_clean refuses them); pasted text often has them. */
export const cleanText = (s: string) =>
  s
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,
      ' ',
    )
    .replace(/ {2,}/g, ' ')
    .trim();

/** The values save_hotel takes (empty optional fields as null). */
export function hotelPayload(v: HotelForm) {
  const opt = (s: string) => cleanText(s) || null;
  return {
    name: cleanText(v.name),
    addressEn: cleanText(v.addressEn),
    addressLocal: opt(v.addressLocal),
    phone: v.phone.trim() ? normalizePhone(v.phone) : null,
    checkIn: v.checkIn!,
    checkOut: v.checkOut!,
    bookingRef: opt(v.bookingRef),
  };
}

/** Design 7: hotels the new trip dates would leave outside, by check-in. */
export function hotelsOutside(hotels: readonly Hotel[], start: string, end: string): Hotel[] {
  return byCheckIn(hotels.filter((h) => h.checkIn < start || h.checkOut > end));
}

export interface InsuranceForm {
  provider: string;
  policyNumber: string;
  validUntil: string | null;
  emergencyPhone: string;
  notes: string;
}

export type InsuranceField = 'provider' | 'policyNumber' | 'emergencyPhone' | 'notes';

export function insuranceErrors(v: InsuranceForm): Partial<Record<InsuranceField, HotelError>> {
  const e: Partial<Record<InsuranceField, HotelError>> = {};
  const p = v.provider.trim();
  if (!p) e.provider = 'required';
  else if (codePointLength(p) > LIMITS.provider) e.provider = 'tooLong';
  if (codePointLength(v.policyNumber.trim()) > LIMITS.ref) e.policyNumber = 'tooLong';
  if (v.emergencyPhone.trim() && !normalizePhone(v.emergencyPhone)) e.emergencyPhone = 'phone';
  if (codePointLength(v.notes.trim()) > LIMITS.notes) e.notes = 'tooLong';
  return e;
}

export function insurancePayload(v: InsuranceForm) {
  const opt = (s: string) => cleanText(s) || null;
  return {
    provider: cleanText(v.provider),
    policyNumber: opt(v.policyNumber),
    validUntil: v.validUntil,
    emergencyPhone: v.emergencyPhone.trim() ? normalizePhone(v.emergencyPhone) : null,
    notes: opt(v.notes),
  };
}

/** AC-7: a policy that ends before the return date warns, but may be saved. */
export const endsEarly = (validUntil: string | null, endDate: string) =>
  validUntil !== null && validUntil < endDate;

/** AC-10: the insurance reminder's day, a week before departure. */
export const reminderDay = (startDate: string) => addDays(startDate, -7);
