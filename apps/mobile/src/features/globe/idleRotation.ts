/**
 * How fast the globe spins on its own (sprint 0 AC-2, AC-6).
 *
 * The globe spins slowly while nobody touches it. A touch stops it; after
 * IDLE_RESUME_MS without touches it eases back to full speed over RAMP_MS.
 * It stays still while a country card is open, and never spins when the
 * device asks for reduced motion.
 */

/** Full auto-rotation speed, in degrees of longitude per second. */
export const ROTATION_DEG_PER_SECOND = 3;
export const IDLE_RESUME_MS = 5_000;
export const RAMP_MS = 1_000;

export interface RotationInputs {
  now: number;
  /** Last touch on the globe, or when the card was closed — whichever is later. */
  lastInteractionAt: number;
  cardOpen: boolean;
  reduceMotion: boolean;
}

/** Rotation speed as a fraction of full speed, from 0 (still) to 1. */
export function rotationFactor({
  now,
  lastInteractionAt,
  cardOpen,
  reduceMotion,
}: RotationInputs): number {
  if (reduceMotion || cardOpen) return 0;

  const idleFor = now - lastInteractionAt - IDLE_RESUME_MS;
  if (idleFor <= 0) return 0;
  if (idleFor >= RAMP_MS) return 1;

  // Ease in (smoothstep) so the globe doesn't lurch back into motion.
  const t = idleFor / RAMP_MS;
  return t * t * (3 - 2 * t);
}

/** Longitude after spinning for `elapsedMs` at the given factor. */
export function advanceLongitude(longitude: number, elapsedMs: number, factor: number): number {
  const next = longitude - (ROTATION_DEG_PER_SECOND * factor * elapsedMs) / 1000;
  return ((((next + 180) % 360) + 360) % 360) - 180;
}
