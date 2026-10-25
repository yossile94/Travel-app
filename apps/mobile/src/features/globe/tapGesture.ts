/**
 * Recognises a tap on the globe from raw touch events (sprint 1 AC-10).
 *
 * Mapbox's onPress on Android waits out the double-tap window before it
 * reports a single tap, which put 0.45–0.8 s between the finger lifting and
 * the highlight. Recognising the tap ourselves, the moment the finger lifts,
 * removes that wait and keeps double-tap zoom working: the first tap of a
 * double tap also selects, which the flight that follows makes harmless.
 */

/** Longest press that still counts as a tap. */
export const TAP_MAX_MS = 300;
/** Farthest a finger may move (dp) and still tap; Android's touch slop is about 8. */
export const TAP_SLOP = 10;

export interface TouchDown {
  x: number;
  y: number;
  at: number;
  /** A second finger came down during this touch: a pinch, never a tap. */
  multiTouch: boolean;
}

export function isTap(down: TouchDown, up: { x: number; y: number; at: number }): boolean {
  if (down.multiTouch) return false;
  if (up.at - down.at > TAP_MAX_MS) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_SLOP;
}
