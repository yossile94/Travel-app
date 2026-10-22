/**
 * Camera maths for the home globe (sprint 0 AC-2, AC-4).
 */
import { motion } from '@/theme/tokens';

/** Zoom that shows the whole globe on a phone. */
export const HOME_ZOOM = 1.2;
export const MIN_COUNTRY_ZOOM = 1.6;
export const MAX_COUNTRY_ZOOM = 6;

/** Starting view: Israel's longitude, tilted north so Europe and Africa are in view. */
export const HOME_CENTER: [number, number] = [34.8, 22];

/**
 * Fly-to zoom for an area of `span` degrees, so it fills roughly half the
 * screen width. At zoom z the world is 512·2^z points wide; a 390-point
 * screen half-filled by span/360 of it gives 2^z ≈ 123 / span.
 */
export function zoomForSpan(span: number): number {
  const zoom = Math.log2(123 / Math.max(span, 0.01));
  return Math.min(MAX_COUNTRY_ZOOM, Math.max(MIN_COUNTRY_ZOOM, zoom));
}

/** Great-circle distance between two [lng, lat] points, in degrees. */
export function greatCircleDegrees([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) {
  const toRad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * toRad) / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(((lng2 - lng1) * toRad) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / toRad;
}

/** Fly-to duration: short for a neighbour, longest for the other side of the world (AC-4). */
export function flightDuration(from: [number, number], to: [number, number]): number {
  const fraction = Math.min(1, greatCircleDegrees(from, to) / 180);
  return Math.round(motion.flyToMin + fraction * (motion.flyToMax - motion.flyToMin));
}

export interface RotationSegment {
  durationMs: number;
  /** Degrees of longitude to move west during the segment. */
  degrees: number;
}

/**
 * The idle auto-rotation as a few camera animations instead of a per-frame
 * update (which would cross the JS–native bridge 60 times a second): a short
 * ramp of rising speed over `autoRotateRamp`, then one long constant segment.
 * The caller chains them and starts a new plan when the long one ends.
 */
export function rotationPlan(longSegmentMs = 20_000): RotationSegment[] {
  const steps = [0.2, 0.5, 0.8];
  const stepMs = motion.autoRotateRamp / steps.length;
  const perMs = motion.autoRotateDegPerSec / 1000;
  return [
    ...steps.map((factor) => ({ durationMs: stepMs, degrees: perMs * stepMs * factor })),
    { durationMs: longSegmentMs, degrees: perMs * longSegmentMs },
  ];
}

/** Longitude after moving `degrees` west, wrapped to [-180, 180). */
export function westOf(longitude: number, degrees: number): number {
  return ((((longitude - degrees + 180) % 360) + 360) % 360) - 180;
}
