import {
  Atmosphere,
  BackgroundLayer,
  CircleLayer,
  FillLayer,
  LineLayer,
  RasterLayer,
  RasterSource,
  ShapeSource,
} from '@rnmapbox/maps';
import { memo, useEffect, useMemo, useState } from 'react';

import { globe, highlightColor, motion } from '@/theme/tokens';

import { smallCountryPoints } from './countryData';

export const LAYER = {
  countriesHit: 'countries-hit',
  /** 22 pt radius: a 44 pt target for small areas, used over the sea (AC-5). */
  smallHitWide: 'small-countries-hit-wide',
  /** 3–10 pt radius by zoom: the only small-area target that counts over land (see resolveTap). */
  smallHitTight: 'small-countries-hit-tight',
} as const;

const RASTER_STYLE = {
  rasterSaturation: globe.raster.saturation,
  rasterContrast: globe.raster.contrast,
  rasterFadeDuration: globe.raster.fadeDuration,
};

interface Props {
  countriesUrl: string | null;
  highlightedAdm0: string | null;
  reduceMotion: boolean;
}

/**
 * Everything drawn on the globe: base ocean, satellite imagery, atmosphere,
 * country borders, the selection highlight and the small-area dots. Memoised
 * so that touches and timers in the screen don't resend every layer's style
 * to the native map.
 */
export const GlobeLayers = memo(function GlobeLayers({
  countriesUrl,
  highlightedAdm0,
  reduceMotion,
}: Props) {
  const highlight = useHighlight(highlightedAdm0, reduceMotion);

  const highlightStyles = useMemo(() => {
    const fade = { duration: reduceMotion ? 0 : motion.highlight, delay: 0 };
    const shown = highlight.visible ? 1 : 0;
    return {
      filter: ['==', ['get', 'adm0'], highlight.adm0 ?? ''] as const,
      fill: {
        fillColor: highlightColor,
        fillOpacity: globe.highlight.fillOpacity * shown,
        fillOpacityTransition: fade,
      },
      glow: {
        lineColor: highlightColor,
        lineWidth: globe.highlight.glowWidth,
        lineBlur: globe.highlight.glowBlur,
        lineOpacity: shown,
        lineOpacityTransition: fade,
      },
      // Dark underlay keeps the outline visible on deserts, ice and clouds (WCAG 1.4.11).
      underlay: {
        lineColor: globe.atmosphere.spaceColor,
        lineWidth: 3,
        lineOpacity: 0.6 * shown,
        lineOpacityTransition: fade,
      },
      outline: {
        lineColor: globe.highlight.outline,
        lineWidth: globe.highlight.outlineWidth,
        lineOpacity: shown,
        lineOpacityTransition: fade,
        lineJoin: 'round' as const,
      },
      dot: {
        circleRadius: ['case', ['==', ['get', 'adm0'], highlight.adm0 ?? ''], 6, 3] as const,
        circleColor: highlightColor,
        circleOpacity: 0.9,
        circleStrokeWidth: 1,
        circleStrokeColor: globe.highlight.outline,
      },
    };
  }, [highlight.adm0, highlight.visible, reduceMotion]);

  return (
    <>
      <Atmosphere style={globe.atmosphere} />
      <BackgroundLayer id="base" style={{ backgroundColor: globe.baseOcean }} />

      <RasterSource id="satellite" url="mapbox://mapbox.satellite" tileSize={256}>
        <RasterLayer id="satellite" style={RASTER_STYLE} />
      </RasterSource>

      <ShapeSource id="small-countries" shape={smallCountryPoints}>
        <CircleLayer id={LAYER.smallHitWide} style={{ circleRadius: 22, circleOpacity: 0 }} />
        {/* Grows with zoom: at the whole-globe view 10 pt is hundreds of km, so a tap
            in central Italy would select the Vatican; zoomed in, the dot is a fair target. */}
        <CircleLayer
          id={LAYER.smallHitTight}
          style={{
            circleRadius: ['interpolate', ['linear'], ['zoom'], 1, 3, 4, 6, 6, 10],
            circleOpacity: 0,
          }}
        />
        <CircleLayer id="small-countries-dot" style={highlightStyles.dot} />
      </ShapeSource>

      {/* The borders arrive asynchronously; keep them under the small-area dots. */}
      {countriesUrl && (
        <ShapeSource id="countries" url={countriesUrl} maxZoomLevel={6}>
          {/* Invisible fill: the hit-test surface for taps on countries. */}
          <FillLayer
            id={LAYER.countriesHit}
            belowLayerID={LAYER.smallHitWide}
            style={{ fillColor: '#000000', fillOpacity: 0 }}
          />
          <LineLayer
            id="countries-border"
            belowLayerID={LAYER.smallHitWide}
            style={{
              lineColor: globe.border,
              lineWidth: [
                'interpolate',
                ['linear'],
                ['zoom'],
                0,
                globe.borderWidthZ0,
                5,
                globe.borderWidthZ5,
              ],
              lineJoin: 'round',
            }}
          />
          <FillLayer
            id="highlight-fill"
            belowLayerID={LAYER.smallHitWide}
            filter={highlightStyles.filter}
            style={highlightStyles.fill}
          />
          <LineLayer
            id="highlight-glow"
            belowLayerID={LAYER.smallHitWide}
            filter={highlightStyles.filter}
            style={highlightStyles.glow}
          />
          <LineLayer
            id="highlight-underlay"
            belowLayerID={LAYER.smallHitWide}
            filter={highlightStyles.filter}
            style={highlightStyles.underlay}
          />
          <LineLayer
            id="highlight-outline"
            belowLayerID={LAYER.smallHitWide}
            filter={highlightStyles.filter}
            style={highlightStyles.outline}
          />
        </ShapeSource>
      )}
    </>
  );
});

/**
 * Mapbox doesn't animate filter changes, so the highlight fades the old
 * country out completely, swaps the filter while the layers are transparent,
 * then fades the new one in.
 */
function useHighlight(target: string | null, reduceMotion: boolean) {
  const [state, setState] = useState<{ adm0: string | null; visible: boolean }>({
    adm0: null,
    visible: false,
  });

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    // Fade out whatever is showing (a no-op when nothing is).
    later(0, () => setState((s) => ({ ...s, visible: false })));
    if (target) {
      const fadeOut = reduceMotion ? 0 : motion.highlight;
      later(fadeOut, () => setState({ adm0: target, visible: false }));
      // One more tick so the native layer has the new filter before it fades in.
      later(fadeOut + 16, () => setState({ adm0: target, visible: true }));
    }
    return () => timers.forEach(clearTimeout);
  }, [target, reduceMotion]);

  return state;
}
