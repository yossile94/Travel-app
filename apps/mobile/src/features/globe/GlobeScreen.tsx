import {
  Atmosphere,
  BackgroundLayer,
  Camera,
  CircleLayer,
  FillLayer,
  LineLayer,
  MapView,
  RasterLayer,
  RasterSource,
  ShapeSource,
} from '@rnmapbox/maps';
import { useCallback, useEffect, useReducer, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  BackHandler,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { globe, highlightColor, motion } from '@/theme/tokens';

import { BoardingPassCard } from './BoardingPassCard';
import { HOME_CENTER, HOME_ZOOM, flightDuration, zoomForSpan } from './camera';
import { countryByAdm0, smallCountryPoints } from './countryData';
import { hasMapboxToken } from './mapbox';
import { handlesBack, initialSelection, selectionReducer } from './selection';
import { useAutoRotation } from './useAutoRotation';
import { useCountriesAsset } from './useCountriesAsset';
import { useReduceMotion } from './useReduceMotion';

/** An empty style: every layer below is ours, so nothing depends on a remote style's layer ids. */
const STYLE_JSON = JSON.stringify({ version: 8, sources: {}, layers: [] });

/** Used for the first flight, before the card has been measured. */
const ESTIMATED_CARD_SPACE = 230;

const LAYER = {
  countriesHit: 'countries-hit',
  smallHit: 'small-countries-hit',
} as const;

/** Home screen globe (sprint 0, F-001). */
export function GlobeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const reduceMotion = useReduceMotion();
  const countries = useCountriesAsset();

  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<ComponentRef<typeof Camera>>(null);
  const cardSpace = useRef(ESTIMATED_CARD_SPACE);
  const gestureActive = useRef(false);

  const [selection, dispatch] = useReducer(selectionReducer, initialSelection);
  const [gestureInProgress, setGestureInProgress] = useState(false);
  // Start "idle" so the globe begins turning (after the ramp) as soon as it appears.
  const [lastInteractionAt, setLastInteractionAt] = useState(
    () => Date.now() - motion.autoRotateResumeDelay,
  );
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [highlightOn, setHighlightOn] = useState(false);

  const selectedAdm0 = selection.selected?.adm0 ?? null;
  const selectedCountry = selectedAdm0 ? countryByAdm0(selectedAdm0) : undefined;

  const getCenter = useCallback(async (): Promise<[number, number] | null> => {
    const center = await mapRef.current?.getCenter();
    return center ? [center[0]!, center[1]!] : null;
  }, []);

  // AC-2: turn slowly while idle; never while a card is open, a gesture or
  // flight is in progress, or the device asks for reduced motion (AC-6).
  useAutoRotation({
    cameraRef,
    getCenter,
    allowed: !reduceMotion && !selectedAdm0 && !selection.flying && !gestureInProgress,
    lastInteractionAt,
  });

  // AC-6: with reduced motion the camera jumps behind a quick fade instead of flying.
  const veil = useSharedValue(0);
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));

  // AC-4: fly to the selected country, lifting the globe above the card.
  useEffect(() => {
    if (!selectedAdm0) return;
    const country = countryByAdm0(selectedAdm0);
    if (!country) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const from = (await getCenter()) ?? HOME_CENTER;
      if (cancelled) return;
      const stop = {
        centerCoordinate: country.label,
        zoomLevel: zoomForSpan(country.span),
        padding: {
          paddingTop: insets.top,
          paddingBottom: cardSpace.current,
          paddingLeft: 0,
          paddingRight: 0,
        },
      };

      if (reduceMotion) {
        veil.set(withTiming(1, { duration: motion.reduceFadeOut }));
        timer = setTimeout(() => {
          cameraRef.current?.setCamera({ ...stop, animationMode: 'none', animationDuration: 0 });
          veil.set(withTiming(0, { duration: motion.reduceFadeIn }));
          dispatch({ type: 'flightEnded' });
        }, motion.reduceFadeOut);
        return;
      }

      const duration = flightDuration(from, country.label);
      cameraRef.current?.setCamera({
        ...stop,
        animationMode: 'flyTo',
        animationDuration: duration,
      });
      timer = setTimeout(() => dispatch({ type: 'flightEnded' }), duration);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // Re-run only for a new selection; insets and motion settings are read at flight time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdm0]);

  // When the card closes, drop the camera padding (it persists otherwise) and
  // restart the 5 s idle countdown.
  const hadSelection = useRef(false);
  useEffect(() => {
    if (selectedAdm0) {
      hadSelection.current = true;
      return;
    }
    if (!hadSelection.current) return;
    hadSelection.current = false;
    cameraRef.current?.setCamera({
      padding: { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 },
      animationMode: reduceMotion ? 'none' : 'easeTo',
      animationDuration: reduceMotion ? 0 : motion.sheet,
    });
    setLastInteractionAt(Date.now());
    AccessibilityInfo.announceForAccessibility(t('globe.closed'));
  }, [selectedAdm0, reduceMotion, t]);

  // Highlight: Mapbox doesn't animate filter changes, so swap the filter while
  // the layers are transparent, then fade them in.
  useEffect(() => {
    const frames: number[] = [];
    frames.push(
      requestAnimationFrame(() => {
        setHighlightOn(false);
        if (!selectedAdm0) return;
        frames.push(
          requestAnimationFrame(() => {
            setHighlighted(selectedAdm0);
            frames.push(requestAnimationFrame(() => setHighlightOn(true)));
          }),
        );
      }),
    );
    const country = selectedAdm0 ? countryByAdm0(selectedAdm0) : undefined;
    if (country) {
      AccessibilityInfo.announceForAccessibility(t('globe.selected', { name: country.nameHe }));
    }
    return () => frames.forEach(cancelAnimationFrame);
  }, [selectedAdm0, t]);

  // AC-4: Android back closes the card instead of leaving the app.
  useEffect(() => {
    if (!handlesBack(selection)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dispatch({ type: 'backPressed' });
      return true;
    });
    return () => subscription.remove();
  }, [selection]);

  const onPress = useCallback(
    async (
      feature: GeoJSON.Feature<GeoJSON.Point, { screenPointX: number; screenPointY: number }>,
    ) => {
      const map = mapRef.current;
      if (!map) return;
      const point: [number, number] = [
        feature.properties.screenPointX,
        feature.properties.screenPointY,
      ];
      setLastInteractionAt(Date.now());

      // AC-5: small countries first, through their enlarged dot.
      const small = await map.queryRenderedFeaturesAtPoint(point, [], [LAYER.smallHit]);
      const smallAdm0 = small?.features[0]?.properties?.adm0 as string | undefined;
      if (smallAdm0) {
        dispatch({ type: 'countryTapped', country: { adm0: smallAdm0 } });
        return;
      }

      const hit = await map.queryRenderedFeaturesAtPoint(point, [], [LAYER.countriesHit]);
      const properties = hit?.features[0]?.properties as
        { adm0?: string; code?: string | null } | undefined;
      if (!properties) {
        dispatch({ type: 'oceanTapped' });
        return;
      }
      // Areas without an ISO code (e.g. the Gaza Strip) are not destinations.
      if (properties.code && properties.adm0 && countryByAdm0(properties.adm0)) {
        dispatch({ type: 'countryTapped', country: { adm0: properties.adm0 } });
      }
    },
    [],
  );

  const onCameraChanged = useCallback((state: { gestures: { isGestureActive: boolean } }) => {
    const active = state.gestures.isGestureActive;
    if (active === gestureActive.current) return;
    gestureActive.current = active;
    setGestureInProgress(active);
    if (!active) setLastInteractionAt(Date.now());
  }, []);

  const mountedAt = useRef<number | null>(null);
  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);
  const onFullyRendered = useCallback(() => {
    // AC-1 measurement points (read from logcat on a preview build).
    const now = performance.now();
    console.log(
      `[perf] globe fully rendered: ${Math.round(now)} ms since JS start, ` +
        `${Math.round(now - (mountedAt.current ?? now))} ms since screen mount`,
    );
  }, []);

  if (!hasMapboxToken) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.error}>{t('globe.loadError')}</Text>
      </View>
    );
  }

  const highlightFilter = ['==', ['get', 'adm0'], highlighted ?? ''] as const;
  const fade = { duration: reduceMotion ? 0 : motion.highlight, delay: 0 };
  const shown = highlightOn ? 1 : 0;

  return (
    <View style={styles.screen}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        projection="globe"
        styleJSON={STYLE_JSON}
        onPress={onPress}
        onCameraChanged={onCameraChanged}
        onDidFinishRenderingMapFully={onFullyRendered}
        scaleBarEnabled={false}
        compassEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        logoPosition={{ top: insets.top + 8, left: 8 }}
        attributionPosition={{ top: insets.top + 8, left: 92 }}
        accessibilityLabel={t('globe.a11yLabel')}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: HOME_CENTER, zoomLevel: HOME_ZOOM }}
          minZoomLevel={0.8}
          maxZoomLevel={8}
        />
        <Atmosphere style={globe.atmosphere} />
        <BackgroundLayer id="base" style={{ backgroundColor: globe.baseOcean }} />

        <RasterSource id="satellite" url="mapbox://mapbox.satellite" tileSize={256}>
          <RasterLayer
            id="satellite"
            style={{
              rasterSaturation: globe.raster.saturation,
              rasterContrast: globe.raster.contrast,
              rasterFadeDuration: globe.raster.fadeDuration,
            }}
          />
        </RasterSource>

        {countries.url && (
          <ShapeSource id="countries" url={countries.url} maxZoomLevel={6}>
            {/* Invisible fill: the hit-test surface for taps on countries. */}
            <FillLayer id={LAYER.countriesHit} style={{ fillColor: '#000000', fillOpacity: 0 }} />
            <LineLayer
              id="countries-border"
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
              filter={highlightFilter}
              style={{
                fillColor: highlightColor,
                fillOpacity: globe.highlight.fillOpacity * shown,
                fillOpacityTransition: fade,
              }}
            />
            <LineLayer
              id="highlight-glow"
              filter={highlightFilter}
              style={{
                lineColor: highlightColor,
                lineWidth: globe.highlight.glowWidth,
                lineBlur: globe.highlight.glowBlur,
                lineOpacity: shown,
                lineOpacityTransition: fade,
              }}
            />
            {/* Dark underlay keeps the outline visible on deserts, ice and clouds (WCAG 1.4.11). */}
            <LineLayer
              id="highlight-underlay"
              filter={highlightFilter}
              style={{
                lineColor: '#03060F',
                lineWidth: 3,
                lineOpacity: 0.6 * shown,
                lineOpacityTransition: fade,
              }}
            />
            <LineLayer
              id="highlight-outline"
              filter={highlightFilter}
              style={{
                lineColor: globe.highlight.outline,
                lineWidth: globe.highlight.outlineWidth,
                lineOpacity: shown,
                lineOpacityTransition: fade,
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        <ShapeSource id="small-countries" shape={smallCountryPoints}>
          {/* 22 pt radius: a 44 pt tap target for countries too small to hit (AC-5). */}
          <CircleLayer id={LAYER.smallHit} style={{ circleRadius: 22, circleOpacity: 0 }} />
          <CircleLayer
            id="small-countries-dot"
            style={{
              circleRadius: ['case', ['==', ['get', 'adm0'], highlighted ?? ''], 6, 3],
              circleColor: highlightColor,
              circleOpacity: 0.9,
              circleStrokeWidth: 1,
              circleStrokeColor: '#F3F6FC',
            }}
          />
        </ShapeSource>
      </MapView>

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.veil, veilStyle]}
      />

      {selectedCountry && (
        <BoardingPassCard
          key={selectedCountry.adm0}
          country={selectedCountry}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          onClose={() => dispatch({ type: 'backPressed' })}
          onHeight={(height) => {
            cardSpace.current = height + 30 + 16;
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The scene is always space, in light and dark mode alike.
  screen: { flex: 1, backgroundColor: globe.atmosphere.spaceColor },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#F3F6FC', fontSize: 15, textAlign: 'center' },
  veil: { backgroundColor: globe.atmosphere.spaceColor },
});
