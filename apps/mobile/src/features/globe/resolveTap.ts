/**
 * Decides what a tap on the globe selects (sprint 0 AC-4, AC-5).
 *
 * Small areas (microstates, tiny islands) are drawn as dots with two hit
 * radii. Over the sea, the wide radius (a 44 pt target) makes them easy to
 * hit. Over land, only the tight radius counts (small when zoomed out), so a
 * tap in Italy selects Italy rather than the Vatican, and a tap in Sicily
 * selects Italy, not Malta; zoom in to pick a microstate inside a country.
 */

export interface TapHits {
  /** adm0 of a small area whose wide (22 pt) target contains the tap. */
  smallWide?: string;
  /** adm0 of a small area whose tight target (3–10 pt, growing with zoom) contains the tap. */
  smallTight?: string;
  /** The country polygon under the tap, if any. */
  country?: { adm0: string; code: string | null; small: boolean };
}

export type TapResult =
  | { type: 'select'; adm0: string }
  | { type: 'ocean' }
  /** Land that is not a destination (e.g. the Gaza Strip): the tap does nothing. */
  | { type: 'ignore' };

export function resolveTap({ smallWide, smallTight, country }: TapHits): TapResult {
  if (smallTight) return { type: 'select', adm0: smallTight };

  // Land under the finger wins over a nearby dot (including a small area's own polygon).
  if (country) return country.code ? { type: 'select', adm0: country.adm0 } : { type: 'ignore' };

  if (smallWide) return { type: 'select', adm0: smallWide };
  return { type: 'ocean' };
}
