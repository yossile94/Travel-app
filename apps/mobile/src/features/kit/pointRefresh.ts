/**
 * Sprint 14 F-043 (AC-3, ADR-021): a hotel's Google point past 30 days is
 * fetched again by its place id when the trip's hotels are shown with a
 * network. Only the point and the place id change; text the user saved stays.
 * Google no longer knowing the place keeps the text and drops the link and
 * the point. Once per hotel per launch; a failure waits for the next launch
 * (the server clears the point within a day either way).
 */
import { saveHotel } from './kitApi';
import type { Hotel } from './kitModel';
import { pointExpired } from './placeFill';
import { refreshHotelPoint } from './placesApi';

const tried = new Set<string>();

/** The values save_hotel takes, from a saved hotel. */
export const savedPayload = (h: Hotel) => ({
  name: h.name,
  nameLocal: h.nameLocal ?? null,
  addressEn: h.addressEn,
  addressLocal: h.addressLocal,
  phone: h.phone,
  checkIn: h.checkIn,
  checkOut: h.checkOut,
  bookingRef: h.bookingRef,
});

/** Resolves true when a hotel was saved again (the caller reloads the kit). */
export async function refreshExpiredPoints(
  hotels: readonly Hotel[],
  now = new Date(),
): Promise<boolean> {
  let saved = false;
  for (const h of hotels) {
    if (!pointExpired(h, now) || tried.has(h.id)) continue;
    tried.add(h.id);
    const answer = await refreshHotelPoint(h.placeId!);
    if (answer.kind === 'ok') {
      const { placeId, lat, lng, fetchedAt } = answer.refreshed;
      const result = await saveHotel(h.id, h.tripId, {
        ...savedPayload(h),
        lat,
        lng,
        placeId,
        placeFetchedAt: fetchedAt,
        placeEdited: h.placeEdited ?? [],
      });
      saved ||= result === 'ok';
    } else if (answer.kind === 'gone') {
      const result = await saveHotel(h.id, h.tripId, {
        ...savedPayload(h),
        lat: null,
        lng: null,
        placeId: null,
        placeEdited: [],
      });
      saved ||= result === 'ok';
    } else if (answer.kind === 'offline') {
      // Not a try: the next showing with a network tries.
      tried.delete(h.id);
    }
  }
  return saved;
}

/** Tests only. */
export const resetPointRefreshForTests = () => tried.clear();
