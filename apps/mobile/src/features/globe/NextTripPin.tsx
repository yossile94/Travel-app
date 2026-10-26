/**
 * The pin on the next trip's country (sprint 3 AC-7, design 9). Layers only
 * (no views), in a memoised component of its own that holds the pulse timer,
 * so a pulse never re-sends the country layers' styles (Raz, R2).
 *
 * The pulse is a ring from the tip: radius 7 → 20 and opacity 0.7 → 0, three
 * style updates per 1.6 s cycle driven by Mapbox transitions (R1), never
 * per frame. It stops whenever the globe isn't free, and under reduced motion.
 */
import { CircleLayer, Images, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import { memo, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { globe } from '@/theme/tokens';

const PIN_IMAGE = require('../../../assets/images/next-trip-pin.png') as number;

export const NEXT_TRIP_HIT = 'next-trip-hit';

export interface NextTripFeature {
  adm0: string;
  tripId: string;
  /** The area's label point, where the small-country rings sit too. */
  coordinate: [number, number];
}

const PULSE = { cycle: 1600, grow: 1200, fadeAt: 100, fade: 1100, from: 7, to: 20, opacity: 0.7 };

interface PulseState {
  radius: number;
  radiusDuration: number;
  opacity: number;
  opacityDuration: number;
}

const RESTING: PulseState = {
  radius: PULSE.from,
  radiusDuration: 0,
  opacity: 0,
  opacityDuration: 0,
};

/** One cycle as timed steps (Raz, R1); exported for tests. */
export const PULSE_STEPS: { at: number; change: Partial<PulseState> }[] = [
  {
    at: 0,
    change: {
      opacity: PULSE.opacity,
      opacityDuration: 0,
      radius: PULSE.to,
      radiusDuration: PULSE.grow,
    },
  },
  { at: PULSE.fadeAt, change: { opacity: 0, opacityDuration: PULSE.fade } },
  // The ring is already invisible: the jump back can't be seen.
  { at: PULSE.grow, change: { radius: PULSE.from, radiusDuration: 0 } },
];
export const PULSE_CYCLE = PULSE.cycle;

function usePulse(running: boolean): PulseState {
  const [state, setState] = useState<PulseState>(RESTING);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => subscription.remove();
  }, []);
  const active = running && foreground;
  useEffect(() => {
    if (!active) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const cycle = () => {
      for (const step of PULSE_STEPS) {
        timers.push(setTimeout(() => setState((s) => ({ ...s, ...step.change })), step.at));
      }
    };
    cycle();
    const interval = setInterval(cycle, PULSE.cycle);
    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
      // Stopping hides the ring at once (design 9.4).
      setState(RESTING);
    };
  }, [active]);
  return state;
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

export const NextTripPin = memo(function NextTripPin({
  feature,
  pulseAllowed,
  reduceMotion,
}: {
  feature: NextTripFeature | null;
  pulseAllowed: boolean;
  reduceMotion: boolean;
}) {
  const pulse = usePulse(Boolean(feature) && pulseAllowed && !reduceMotion);
  const shape = useMemo(
    () =>
      feature
        ? {
            type: 'FeatureCollection' as const,
            features: [
              {
                type: 'Feature' as const,
                id: feature.tripId,
                properties: { adm0: feature.adm0, tripId: feature.tripId },
                geometry: { type: 'Point' as const, coordinates: feature.coordinate },
              },
            ],
          }
        : EMPTY,
    [feature],
  );

  return (
    <>
      <Images images={{ 'next-trip-pin': PIN_IMAGE }} />
      {/* Mounted from the first render, empty until there is a trip (design 9.2). */}
      <ShapeSource id="next-trip" shape={shape}>
        <CircleLayer
          id="next-trip-pulse"
          aboveLayerID="small-countries-ring"
          style={{
            circleRadius: pulse.radius,
            circleRadiusTransition: { duration: pulse.radiusDuration, delay: 0 },
            circleOpacity: 0,
            circleStrokeColor: globe.trips.color,
            circleStrokeWidth: 2,
            circleStrokeOpacity: pulse.opacity,
            circleStrokeOpacityTransition: { duration: pulse.opacityDuration, delay: 0 },
            circlePitchAlignment: 'viewport',
            circlePitchScale: 'viewport',
          }}
        />
        <SymbolLayer
          id="next-trip-pin"
          aboveLayerID="next-trip-pulse"
          style={{
            iconImage: 'next-trip-pin',
            iconSize: 1,
            iconAnchor: 'bottom',
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            iconPitchAlignment: 'viewport',
            iconRotationAlignment: 'viewport',
          }}
        />
        {/* Invisible, for the tap; queried before the countries (design 9.5). */}
        <CircleLayer
          id={NEXT_TRIP_HIT}
          style={{
            circleRadius: 32,
            circleColor: '#000000',
            circleOpacity: 0,
            circleStrokeWidth: 0,
            circlePitchAlignment: 'viewport',
          }}
        />
      </ShapeSource>
    </>
  );
});
