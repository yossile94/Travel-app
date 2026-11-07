/**
 * Sprint 14 F-043 (AC-2, AC-3; design 1.5; Raz design approval 5 – 7): what a
 * Google pick puts in the hotel form, what counts as the user's own edit, and
 * Google's 30 days on the point (ADR-021). Pure, so the screen and the tests
 * share it.
 */
import { codePointLength } from '@/features/trips/tripDates';

import { cleanText, type Hotel, type HotelForm, LIMITS } from './kitModel';
import { normalizePhone } from './phone';
import type { PickedPlace } from './placesApi';

export type FillField = 'name' | 'nameLocal' | 'addressEn' | 'addressLocal' | 'phone';
export const FILL_FIELDS: readonly FillField[] = [
  'name',
  'nameLocal',
  'addressEn',
  'addressLocal',
  'phone',
];
export type EditedField = FillField | 'point';

/** What Google gave for each field, as the form would hold it ('' when nothing). */
export type GoogleFill = Record<FillField, string> & {
  point: [number, number] | null;
  placeId: string;
  fetchedAt: string;
};

export const POINT_DAYS = 30;

/** At most `max` code points, so a long Google value never fails the save (Raz 4). */
function clamp(s: string | null | undefined, max: number): string {
  const text = cleanText(s ?? '');
  return codePointLength(text) > max ? [...text].slice(0, max).join('').trim() : text;
}

/**
 * Design 1.5: the English name and address on top; the local ones only when
 * they differ (empty in an English-speaking country); the phone in E.164 or
 * nothing (Raz 7); the point as [lng, lat].
 */
export function googleFill(place: PickedPlace): GoogleFill {
  const nameEn = clamp(place.nameEn, LIMITS.hotelName);
  const nameLocal = clamp(place.nameLocal, LIMITS.hotelName);
  const addressEn = clamp(place.addressEn, LIMITS.address);
  const addressLocal = clamp(place.addressLocal, LIMITS.address);
  return {
    name: nameEn || nameLocal,
    nameLocal: nameLocal && nameLocal !== nameEn ? nameLocal : '',
    addressEn: addressEn || addressLocal,
    addressLocal: addressLocal && addressLocal !== addressEn ? addressLocal : '',
    phone: (place.phone && normalizePhone(place.phone)) || '',
    point: place.lat !== null && place.lng !== null ? [place.lng, place.lat] : null,
    placeId: place.placeId,
    fetchedAt: place.fetchedAt,
  };
}

/**
 * Design 1.5: a pick replaces the five fields and the point. Where Google has
 * nothing, a value the last pick put there is cleared, and one the user typed
 * stays. Dates and the booking number are never touched.
 */
export function applyFill(
  form: HotelForm,
  point: [number, number] | null,
  fill: GoogleFill,
  previous: GoogleFill | null,
): { form: HotelForm; point: [number, number] | null } {
  const next = { ...form };
  for (const field of FILL_FIELDS) {
    if (fill[field]) next[field] = fill[field];
    else if (previous?.[field] && form[field] === previous[field]) next[field] = '';
  }
  let nextPoint = point;
  if (fill.point) nextPoint = fill.point;
  else if (previous?.point && samePointAs(point, previous.point)) nextPoint = null;
  return { form: next, point: nextPoint };
}

export const samePointAs = (a: [number, number] | null, b: [number, number] | null) =>
  a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);

/** Design 1.5: the field still holds what Google gave ("Filled in from Google"). */
export const fromGoogle = (form: HotelForm, fill: GoogleFill | null, field: FillField) =>
  !!fill && !!fill[field] && form[field] === fill[field];

/**
 * Raz design approval 6: the fields whose value differs from Google's in this
 * session; 'point' when the user moved it, so a refresh never moves it back.
 * Without a pick in this session (an edit of a saved hotel), the saved list
 * stays, with 'point' added when the point changed.
 */
export function editedFields(
  form: HotelForm,
  point: [number, number] | null,
  fill: GoogleFill | null,
  saved: Hotel | null,
): EditedField[] {
  if (!fill) {
    // A field not yet listed still held Google's value at the last save, so any
    // change from the saved value is the user's (Raz app review 3).
    const list = new Set<EditedField>((saved?.placeEdited ?? []) as EditedField[]);
    if (saved?.placeId) {
      for (const f of FILL_FIELDS) {
        if (cleanText(form[f]) !== (saved[f] ?? '')) list.add(f);
      }
      if (!samePointAs(point, saved.point ?? null)) list.add('point');
    }
    return [...list].sort();
  }
  const list: EditedField[] = FILL_FIELDS.filter((f) => cleanText(form[f]) !== fill[f]);
  if (!samePointAs(point, fill.point)) list.push('point');
  return list.sort();
}

/**
 * ADR-021: a point from Google is good for 30 days unless the user moved it.
 * After that it is refreshed when there is a network, or not used.
 */
export function pointExpired(h: Hotel, now: Date): boolean {
  // Without the point too: the daily job may have cleared it; the place id is
  // kept so it can come back (Raz app review 1).
  if (!h.placeId || !h.placeFetchedAt) return false;
  if ((h.placeEdited ?? []).includes('point')) return false;
  return now.getTime() - Date.parse(h.placeFetchedAt) > POINT_DAYS * 86_400_000;
}

/** The hotel as the device may use it: an expired Google point is dropped. */
export const withLivePoint = (h: Hotel, now: Date): Hotel =>
  pointExpired(h, now) ? { ...h, point: null } : h;

/** ADR-021 §5: Google's attribution shows while any of its text is still there. */
export const fromPlaces = (h: Pick<Hotel, 'placeId' | 'placeEdited'>) =>
  !!h.placeId && !FILL_FIELDS.every((f) => (h.placeEdited ?? []).includes(f));
