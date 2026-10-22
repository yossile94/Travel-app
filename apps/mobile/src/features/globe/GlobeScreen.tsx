import { Camera, MapView } from '@rnmapbox/maps';
import { StatusBar } from 'expo-status-bar';
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

import { globe, motion } from '@/theme/tokens';

import { BoardingPassCard, CARD_GAP } from './BoardingPassCard';
import { HOME_CENTER, HOME_ZOOM, flightDuration, zoomForSpan } from './camera';
import { countryByAdm0 } from './countryData';
import { GlobeLayers, LAYER } from './GlobeLayers';
import { hasMapboxToken } from './mapbox';
import { logGlobeReady, markGlobeMounted } from './perfLog';
import { resolveTap, type TapHits } from './resolveTap';
import { handlesBack, initialSelection, selectionReducer } from './selection';
import { useAutoRotation } from './useAutoRotation';
import { useCountriesAsset } from './useCountriesAsset';
import { useReduceMotion } from './useReduceMotion';

/** An empty style: every layer is ours, so nothing depends on a remote style's layer ids. */
const STYLE_JSON = JSON.stringify({ version: 8, sources: {}, layers: [] });

/** Card height before it has been measured, for the first flight's camera padding. */
const ESTIMATED_CARD_HEIGHT = 184;

/** End-to-end tests (Maestro) build with EXPO_PUBLIC_E2E=1: a still globe at a fixed view. */
const E2E = process.env.EXPO_PUBLIC_E2E === '1';

type CameraHandle = ComponentRef<typeof Camera>;
type PressFeature = GeoJSON.Feature<GeoJSON.Point, { screenPointX: number; screenPointY: number }>;

/** Home screen globe (sprint 0, F-001). */
export function GlobeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const reduceMotion = useReduceMotion();
  const countries = useCountriesAsset();

  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<CameraHandle>(null);
  const cardHeight = useRef(ESTIMATED_CARD_HEIGHT);
  const touches = useRef(0);

  const [selection, dispatch] = useReducer(selectionReducer, initialSelection);
  const [fingerDown, setFingerDown] = useState(false);
  // Start "idle" so the globe begins turning (after the ramp) as soon as it appears.
  const [lastInteractionAt, setLastInteractionAt] = useState(
    () => Date.now() - motion.autoRotateResumeDelay,
  );

  const selectedAdm0 = selection.selected?.adm0 ?? null;
  const selectedCountry = selectedAdm0 ? countryByAdm0(selectedAdm0) : undefined;

  const getCenter = useCallback(async (): Promise<[number, number] | null> => {
    try {
      const center = await mapRef.current?.getCenter();
      return center ? [center[0]!, center[1]!] : null;
    } catch {
      return null;
    }
  }, []);

  // AC-2: turn slowly while idle; never while a card is open, a finger or a
  // flight is on the globe, or the device asks for reduced motion (AC-6).
  useAutoRotation({
    cameraRef,
    getCenter,
    allowed: !E2E && !reduceMotion && !selectedAdm0 && !selection.flying && !fingerDown,
    lastInteractionAt,
  });

  // AC-6: switching "Remove animations" on mid-turn stops the native animation
  // (a zero-length camera move cancels it), not just the next segment.
  useEffect(() => {
    if (!reduceMotion) return;
    void getCenter().then((center) => {
      if (center) cameraRef.current?.setCamera({ centerCoordinate: center, animationDuration: 0 });
    });
  }, [reduceMotion, getCenter]);

  // Touches are tracked on the view around the map: Mapbox on Android only
  // reports a gesture's end when the camera moves afterwards, so a drag that
  // stops before lifting the finger would leave rotation off for good.
  const onTouchStart = useCallback(() => {
    touches.current += 1;
    setFingerDown(true);
  }, []);
  const onTouchEnd = useCallback(() => {
    touches.current = Math.max(0, touches.current - 1);
    if (touches.current === 0) {
      setFingerDown(false);
      setLastInteractionAt(Date.now());
    }
  }, []);

  // AC-6: with reduced motion the camera jumps behind a quick fade instead of flying.
  const veil = useSharedValue(0);
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));

  // AC-4: fly to the selected country, lifting the globe above the card.
  useEffect(() => {
    const country = selectedAdm0 ? countryByAdm0(selectedAdm0) : undefined;
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
          paddingBottom: cardHeight.current + insets.bottom + CARD_GAP * 2,
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
      // A card closed within the fade must not leave the screen covered.
      veil.set(withTiming(0, { duration: motion.reduceFadeIn }));
    };
    // Re-run only for a new selection; insets and motion settings are read at flight time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAdm0]);

  // When the card closes: back out to the whole globe (the padding persists
  // otherwise), and restart the 5 s idle countdown.
  const hadSelection = useRef(false);
  useEffect(() => {
    if (selectedAdm0) {
      hadSelection.current = true;
      const country = countryByAdm0(selectedAdm0);
      if (country)
        AccessibilityInfo.announceForAccessibility(t('globe.selected', { name: country.nameHe }));
      return;
    }
    if (!hadSelection.current) return;
    hadSelection.current = false;
    cameraRef.current?.setCamera({
      zoomLevel: HOME_ZOOM,
      padding: { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 },
      animationMode: reduceMotion ? 'none' : 'easeTo',
      animationDuration: reduceMotion ? 0 : motion.flyToMin,
    });
    setLastInteractionAt(Date.now());
    AccessibilityInfo.announceForAccessibility(t('globe.closed'));
  }, [selectedAdm0, reduceMotion, t]);

  // AC-4: Android back closes the card instead of leaving the app.
  useEffect(() => {
    if (!handlesBack(selection)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dispatch({ type: 'backPressed' });
      return true;
    });
    return () => subscription.remove();
  }, [selection]);

  const onPress = useCallback(async (feature: PressFeature) => {
    const map = mapRef.current;
    if (!map) return;
    const point: [number, number] = [
      feature.properties.screenPointX,
      feature.properties.screenPointY,
    ];
    const firstAdm0 = async (layer: string) => {
      const result = await map.queryRenderedFeaturesAtPoint(point, [], [layer]);
      return result?.features[0]?.properties as { adm0?: string; code?: string | null } | undefined;
    };

    const [wide, tight, country] = await Promise.all([
      firstAdm0(LAYER.smallHitWide),
      firstAdm0(LAYER.smallHitTight),
      firstAdm0(LAYER.countriesHit),
    ]);
    const hits: TapHits = {
      smallWide: wide?.adm0,
      smallTight: tight?.adm0,
      country: country?.adm0
        ? {
            adm0: country.adm0,
            code: country.code ?? null,
            small: Boolean(countryByAdm0(country.adm0)?.small),
          }
        : undefined,
    };

    const result = resolveTap(hits);
    if (result.type === 'select' && countryByAdm0(result.adm0)) {
      dispatch({ type: 'countryTapped', country: { adm0: result.adm0 } });
    } else if (result.type === 'ocean') {
      dispatch({ type: 'oceanTapped' });
    }
  }, []);

  // AC-1: log once, after the borders are on the map, not before.
  useEffect(markGlobeMounted, []);
  const loggedReady = useRef(false);
  const onFullyRendered = useCallback(() => {
    if (loggedReady.current || !countries.url) return;
    loggedReady.current = true;
    logGlobeReady();
  }, [countries.url]);

  useEffect(() => {
    if (countries.error) console.error('[globe] could not load country borders', countries.error);
  }, [countries.error]);

  if (!hasMapboxToken) {
    return (
      <View style={[styles.screen, styles.center]}>
        <StatusBar style="light" />
        <Text style={styles.message}>{t('globe.loadError')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* The scene is always space, so the status bar is always light (AC-7). */}
      <StatusBar style="light" />
      <View
        style={StyleSheet.absoluteFill}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          projection="globe"
          styleJSON={STYLE_JSON}
          onPress={onPress}
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
          <GlobeLayers
            countriesUrl={countries.url}
            highlightedAdm0={selectedAdm0}
            reduceMotion={reduceMotion}
          />
        </MapView>
      </View>

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.veil, veilStyle]}
      />

      {countries.error && (
        <View style={[styles.banner, { top: insets.top + 56 }]} pointerEvents="none">
          <Text style={styles.message}>{t('globe.loadError')}</Text>
        </View>
      )}

      {selectedCountry && (
        <BoardingPassCard
          key={selectedCountry.adm0}
          country={selectedCountry}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          bottomInset={insets.bottom}
          onClose={() => dispatch({ type: 'backPressed' })}
          onHeight={(height) => {
            cardHeight.current = height;
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
  message: { color: '#F3F6FC', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  veil: { backgroundColor: globe.atmosphere.spaceColor },
  banner: {
    position: 'absolute',
    start: 16,
    end: 16,
    padding: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(11,19,38,0.72)',
  },
});
