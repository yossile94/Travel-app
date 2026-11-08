/**
 * Sprint 14 F-043 (AC-3, ADR-021): a hotel's Google point past 30 days, or
 * cleared by the daily job, is fetched again by its place id when the trip's
 * hotels are shown with a network. Only the point and the link change, through
 * refresh_hotel_point, so an edit made meanwhile is never written over (Raz
 * app review 2). Google no longer knowing the place keeps the text and drops
 * the link and the point. Once per hotel per launch; offline isn't a try.
 */
import { refreshHotelPointOnServer } from './kitApi';
import type { Hotel } from './kitModel';
import { pointExpired } from './placeFill';
import { refreshHotelPoint } from './placesApi';

const tried = new Set<string>();

/** Resolves true when a hotel changed on the server (the caller reloads the kit). */
export async function refreshExpiredPoints(
  hotels: readonly Hotel[],
  now = new Date(),
): Promise<boolean> {
  let changed = false;
  for (const h of hotels) {
    if (!pointExpired(h, now) || tried.has(h.id)) continue;
    tried.add(h.id);
    const answer = await refreshHotelPoint(h.placeId!);
    if (answer.kind === 'ok') {
      changed ||= (await refreshHotelPointOnServer(h.id, h.placeId!, answer.refreshed)) === 'ok';
    } else if (answer.kind === 'gone') {
      changed ||= (await refreshHotelPointOnServer(h.id, h.placeId!, null)) === 'ok';
    } else if (answer.kind === 'offline') {
      tried.delete(h.id);
    }
  }
  return changed;
}

/** Tests only. */
export const resetPointRefreshForTests = () => tried.clear();
