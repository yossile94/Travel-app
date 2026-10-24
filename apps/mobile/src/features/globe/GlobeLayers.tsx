import {
  Atmosphere,
  BackgroundLayer,
  CircleLayer,
  FillLayer,
  LineLayer,
  RasterLayer,
  RasterSource,
  ShapeSource,
  type FillLayerStyle,
  type LineLayerStyle,
} from '@rnmapbox/maps';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { globe, highlightColor, motion } from '@/theme/tokens';

import { smallCountryPoints } from './countryData';

export const LAYER = {
  /** Invisible country fills for taps, one per border level; at any zoom only one is drawn. */
  countriesCoarseHit: 'countries-coarse-hit',
  countriesDetailedHit: 'countries-detailed-hit',
  /** 22 pt radius: a 44 pt target for small areas, used over the sea (AC-5). */
  smallHitWide: 'small-countries-hit-wide',
  /** 3–10 pt radius by zoom: the only small-area target that counts over land (see resolveTap). */
  smallHitTight: 'small-countries-hit-tight',
} as const;

const RASTER_STYLE = {
  rasterSaturation: globe.raster.saturation,
  rasterContrast: globe.raster.contrast,
  rasterBrightnessMin: globe.raster.brightnessMin,
  rasterBrightnessMax: globe.raster.brightnessMax,
  rasterFadeDuration: globe.raster.fadeDuration,
};

// Sprint 1 AC-8: navy over the sea at the whole-globe view, fading out as the
// imagery itself becomes good enough (design 6.2).
const OCEAN_TINT_STYLE: FillLayerStyle = {
  fillColor: globe.oceanTint,
  fillOpacity: [
    'interpolate',
    ['linear'],
    ['zoom'],
    globe.oceanTintFadeStartZoom,
    globe.oceanTintOpacity,
    globe.oceanTintFadeEndZoom,
    0,
  ],
  fillAntialias: false,
};

const BORDER_STYLE: LineLayerStyle = {
  lineColor: globe.border,
  lineWidth: [
    'interpolate',
    ['linear'],
    ['zoom'],
    0,
    globe.borderWidthZ0,
    3,
    globe.borderWidthZ3,
    5,
    globe.borderWidthZ5,
    8,
    globe.borderWidthZ8,
  ],
  lineJoin: 'round',
  lineCap: 'round',
};

interface Props {
  countriesUrl: string | null;
  /** Mounted only after the globe is ready (AC-13a); until then the coarse borders show at every zoom. */
  detailedCountriesUrl: string | null;
  /** The detailed borders are parsed and drawn; only then do the coarse ones stop at zoom 3. */
  detailedDrawn: boolean;
  oceanMaskUrl: string | null;
  highlightedAdm0: string | null;
  reduceMotion: boolean;
}

/**
 * Everything drawn on the globe: base ocean, satellite imagery, atmosphere,
 * country borders, the selection highlight and the small-area ring. Memoised
 * so that touches and timers in the screen don't resend every layer's style
 * to the native map.
 */
export const GlobeLayers = memo(function GlobeLayers({
  countriesUrl,
  detailedCountriesUrl,
  detailedDrawn,
  oceanMaskUrl,
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
      // Sprint 1 AC-7: no dots any more; a selected small country gets a white
      // ring instead, with a dark underlay so it reads over ice and desert.
      ringUnderlay: {
        circleRadius: globe.selectionRing.radius,
        circleOpacity: 0,
        circleStrokeWidth: globe.selectionRing.underlayWidth,
        circleStrokeColor: globe.selectionRing.underlayColor,
        circleStrokeOpacity: globe.selectionRing.underlayOpacity * shown,
        circleStrokeOpacityTransition: fade,
      },
      ring: {
        circleRadius: globe.selectionRing.radius,
        circleOpacity: 0,
        circleStrokeWidth: globe.selectionRing.width,
        circleStrokeColor: globe.selectionRing.color,
        circleStrokeOpacity: shown,
        circleStrokeOpacityTransition: fade,
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
        <CircleLayer
          id="small-countries-ring-underlay"
          filter={highlightStyles.filter}
          style={highlightStyles.ringUnderlay}
        />
        <CircleLayer
          id="small-countries-ring"
          filter={highlightStyles.filter}
          style={highlightStyles.ring}
        />
      </ShapeSource>

      {oceanMaskUrl && (
        <ShapeSource id="ocean-mask" url={oceanMaskUrl} maxZoomLevel={4}>
          <FillLayer
            id="ocean-tint"
            aboveLayerID="satellite"
            maxZoomLevel={globe.oceanTintFadeEndZoom}
            style={OCEAN_TINT_STYLE}
          />
        </ShapeSource>
      )}

      {/* The borders arrive asynchronously; keep them under the small-area ring. */}
      {countriesUrl && (
        <BorderLevel
          level="coarse"
          url={countriesUrl}
          // Coarse vertices gain nothing from deeper tiles.
          sourceMaxZoom={3}
          maxZoom={detailedCountriesUrl && detailedDrawn ? globe.borderDetailMinZoom : undefined}
          highlight={highlightStyles}
        />
      )}
      {detailedCountriesUrl && (
        <BorderLevel
          level="detailed"
          url={detailedCountriesUrl}
          sourceMaxZoom={8}
          minZoom={globe.borderDetailMinZoom}
          highlight={highlightStyles}
        />
      )}
    </>
  );
});

interface BorderLevelProps {
  level: 'coarse' | 'detailed';
  url: string;
  sourceMaxZoom: number;
  minZoom?: number;
  maxZoom?: number;
  highlight: {
    filter: readonly unknown[];
    fill: object;
    glow: object;
    underlay: object;
    outline: object;
  };
}

/**
 * One level of country borders (AC-13a): its own source and layer ids,
 * including the tap surface and the selection highlight, so what is drawn at
 * a zoom is exactly what a tap there hits.
 */
function BorderLevel({ level, url, sourceMaxZoom, minZoom, maxZoom, highlight }: BorderLevelProps) {
  const layerProps = {
    belowLayerID: LAYER.smallHitWide,
    minZoomLevel: minZoom,
    maxZoomLevel: maxZoom,
  };
  const filter = highlight.filter as never;
  return (
    <ShapeSource id={`countries-${level}`} url={url} maxZoomLevel={sourceMaxZoom}>
      {/* Invisible fill: the hit-test surface for taps on countries. */}
      <FillLayer
        id={level === 'coarse' ? LAYER.countriesCoarseHit : LAYER.countriesDetailedHit}
        {...layerProps}
        style={{ fillColor: '#000000', fillOpacity: 0 }}
      />
      <LineLayer id={`countries-${level}-border`} {...layerProps} style={BORDER_STYLE} />
      <FillLayer
        id={`highlight-${level}-fill`}
        {...layerProps}
        filter={filter}
        style={highlight.fill}
      />
      <LineLayer
        id={`highlight-${level}-glow`}
        {...layerProps}
        filter={filter}
        style={highlight.glow}
      />
      <LineLayer
        id={`highlight-${level}-underlay`}
        {...layerProps}
        filter={filter}
        style={highlight.underlay}
      />
      <LineLayer
        id={`highlight-${level}-outline`}
        {...layerProps}
        filter={filter}
        style={highlight.outline}
      />
    </ShapeSource>
  );
}

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

  // Whether a highlight is on screen right now; read when the target changes.
  const showing = useRef(false);
  useEffect(() => {
    showing.current = state.visible && state.adm0 !== null;
  }, [state]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    // Fade out whatever is showing; with nothing showing, don't wait for it.
    const fadeOut = showing.current && !reduceMotion ? motion.highlight : 0;
    later(0, () => setState((s) => ({ ...s, visible: false })));
    if (target) {
      later(fadeOut, () => setState({ adm0: target, visible: false }));
      // One more tick so the native layer has the new filter before it fades in.
      later(fadeOut + 16, () => setState({ adm0: target, visible: true }));
    }
    return () => timers.forEach(clearTimeout);
  }, [target, reduceMotion]);

  return state;
}
