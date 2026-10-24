import { Camera, MapView } from '@rnmapbox/maps';
import * as Linking from 'expo-linking';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  BackHandler,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type GestureResponderEvent,
} from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Toast } from '@/components/formControls';
import { AccountButton } from '@/features/auth/AccountButton';
import { AccountSheet, SignInSheet } from '@/features/auth/AccountSheets';
import { useAuth } from '@/features/auth/AuthProvider';
import { ConsentScreen } from '@/features/auth/ConsentScreen';
import { SearchBar } from '@/features/search/SearchBar';
import { globe, layout, motion } from '@/theme/tokens';

import { BoardingPassCard, CARD_GAP } from './BoardingPassCard';
import { HOME_CENTER, HOME_ZOOM, flightDuration, zoomForSpan } from './camera';
import { countryByAdm0 } from './countryData';
import { GlobeLayers, LAYER } from './GlobeLayers';
import { hasMapboxToken } from './mapbox';
import { logGlobeReady, markGlobeMounted } from './perfLog';
import { resolveTap, type TapHits } from './resolveTap';
import { SystemScrims } from './SystemScrims';
import { isTap, type TouchDown } from './tapGesture';
import { handlesBack, initialSelection, selectionReducer } from './selection';
import { useAutoRotation } from './useAutoRotation';
import {
  useCountriesAsset,
  useDetailedCountriesAsset,
  useOceanMaskAsset,
} from './useCountriesAsset';
import { useReduceMotion } from './useReduceMotion';

/** An empty style: every layer is ours, so nothing depends on a remote style's layer ids. */
const STYLE_JSON = JSON.stringify({ version: 8, sources: {}, layers: [] });

const DEFAULT_CAMERA = { centerCoordinate: HOME_CENTER, zoomLevel: HOME_ZOOM };

/** Card height before it has been measured, for the first flight's camera padding. */
const ESTIMATED_CARD_HEIGHT = 184;

/** How long after "map loaded" the globe counts as ready if Mapbox never goes idle. */
const GLOBE_READY_FALLBACK_MS = 5000;

/** End-to-end tests (Maestro) build with EXPO_PUBLIC_E2E=1: a still globe at a fixed view. */
const E2E = process.env.EXPO_PUBLIC_E2E === '1';

// The fade is what replaces the flight under reduced motion (AC-6), so it must
// run even then: Reanimated's default (ReduceMotion.System) would snap it to black.
const VEIL_FADE_OUT = { duration: motion.reduceFadeOut, reduceMotion: ReduceMotion.Never };
const VEIL_FADE_IN = { duration: motion.reduceFadeIn, reduceMotion: ReduceMotion.Never };

type CameraHandle = ComponentRef<typeof Camera>;

/** Home screen globe (sprint 0, F-001) with country search (sprint 1, F-002). */
export function GlobeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const reduceMotion = useReduceMotion();
  const countries = useCountriesAsset();
  const oceanMask = useOceanMaskAsset();

  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<CameraHandle>(null);
  const cardHeight = useRef(ESTIMATED_CARD_HEIGHT);

  const [selection, dispatch] = useReducer(selectionReducer, initialSelection);
  const [fingerDown, setFingerDown] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const auth = useAuth();
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  // An expired session opens the sign-in sheet by itself (design 4.2).
  const expired = auth.state.status === 'signedOut' && auth.state.expired;
  const sheetOpen = accountSheetOpen || expired;
  const consentShown = auth.state.status === 'needsConsent';
  // Until Mapbox has loaded the map, getCenter() answers [0, 0] rather than
  // the default camera, so rotation would jump the globe to 0°,0° (seen on device).
  const [mapLoaded, setMapLoaded] = useState(false);
  // AC-13a: the detailed borders never compete with the first frame.
  const detailedCountries = useDetailedCountriesAsset(mapLoaded);
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

  // AC-2: turn slowly while idle; never while a card or search is open, a
  // finger or a flight is on the globe, or the device asks for reduced motion (AC-6).
  // `reduceMotion` is null until the setting is known, so the globe doesn't
  // start a ramp it would have to stop a moment later.
  const rotationAllowed =
    !E2E &&
    mapLoaded &&
    reduceMotion === false &&
    !selectedAdm0 &&
    !selection.flying &&
    !fingerDown &&
    !searchOpen &&
    // Design 5.1: the globe holds still behind the consent screen and sheets.
    !sheetOpen &&
    !consentShown;
  useAutoRotation({ cameraRef, getCenter, allowed: rotationAllowed, lastInteractionAt });

  /** Cancels a native rotation segment in flight (a zero-length move stops every animator). */
  const stopRotation = useCallback(() => {
    void getCenter().then((center) => {
      if (center) cameraRef.current?.setCamera({ centerCoordinate: center, animationDuration: 0 });
    });
  }, [getCenter]);

  // E2E builds only: travelapp://?lng=12&lat=42.8&zoom=4 puts the camera at an
  // exact view, so Maestro can tap a known point on screen.
  const link = Linking.useURL();
  useEffect(() => {
    if (!E2E || !link) return;
    const { queryParams } = Linking.parse(link);
    const lng = Number(queryParams?.lng);
    const lat = Number(queryParams?.lat);
    const zoom = Number(queryParams?.zoom ?? HOME_ZOOM);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(zoom)) return;
    cameraRef.current?.setCamera({
      centerCoordinate: [lng, lat],
      zoomLevel: zoom,
      animationMode: 'none',
      animationDuration: 0,
    });
  }, [link]);

  // AC-6: switching "Remove animations" on mid-turn stops the native animation
  // (a zero-length camera move cancels it), not just the next segment.
  // With a card open there is no rotation to stop, and a jump would cut a flight short.
  useEffect(() => {
    if (reduceMotion && !selectedAdm0) stopRotation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, stopRotation]);

  // Touches are tracked on the view around the map: Mapbox on Android only
  // reports a gesture's end when the camera moves afterwards, so a drag that
  // stops before lifting the finger would leave rotation off for good. The
  // count comes from each event rather than a running tally, so a lost
  // end/cancel event can't leave it stuck.
  // The same events also recognise taps (AC-10, see tapGesture.ts).
  const touchDown = useRef<TouchDown | null>(null);
  const handleTapRef = useRef<(point: [number, number]) => void>(() => {});
  const onTouchStart = useCallback((event: GestureResponderEvent) => {
    const { touches, pageX, pageY } = event.nativeEvent;
    setFingerDown(true);
    if (touches.length > 1) {
      if (touchDown.current) touchDown.current.multiTouch = true;
      return;
    }
    touchDown.current = { x: pageX, y: pageY, at: Date.now(), multiTouch: false };
  }, []);
  const onTouchEnd = useCallback((event: GestureResponderEvent) => {
    const { touches, pageX, pageY } = event.nativeEvent;
    if (touches.length > 0) return;
    setFingerDown(false);
    setLastInteractionAt(Date.now());
    const down = touchDown.current;
    touchDown.current = null;
    if (down && isTap(down, { x: pageX, y: pageY, at: Date.now() })) {
      handleTapRef.current([pageX, pageY]);
    }
  }, []);
  // A cancel means the gesture ended for us; the finger may still be on the
  // glass, but no end event will follow, so treat it as lifted.
  const onTouchCancel = useCallback(() => {
    touchDown.current = null;
    setFingerDown(false);
    setLastInteractionAt(Date.now());
  }, []);

  const rotationAllowedRef = useRef(rotationAllowed);
  useEffect(() => {
    rotationAllowedRef.current = rotationAllowed;
  }, [rotationAllowed]);

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
        veil.set(withTiming(1, VEIL_FADE_OUT));
        timer = setTimeout(() => {
          cameraRef.current?.setCamera({ ...stop, animationMode: 'none', animationDuration: 0 });
          veil.set(withTiming(0, VEIL_FADE_IN));
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
      veil.set(withTiming(0, VEIL_FADE_IN));
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

  // AC-4: Android back closes the card instead of leaving the app. While
  // search is open, back belongs to search (sprint 1 design 5.5).
  useEffect(() => {
    if (!handlesBack(selection) || searchOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dispatch({ type: 'backPressed' });
      return true;
    });
    return () => subscription.remove();
  }, [selection, searchOpen]);

  // Sprint 1 F-002: search pauses the globe; choosing a result is a tap on it.
  const openSearch = useCallback(() => {
    if (rotationAllowedRef.current) stopRotation();
    setSearchOpen(true);
  }, [stopRotation]);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setLastInteractionAt(Date.now());
  }, []);
  const selectFromSearch = useCallback((adm0: string) => {
    setSearchOpen(false);
    if (countryByAdm0(adm0)) dispatch({ type: 'countryTapped', country: { adm0 } });
  }, []);

  const handleTap = useCallback(
    async (point: [number, number]) => {
      const map = mapRef.current;
      if (!map) return;
      // A tap doesn't move the camera, so Mapbox doesn't cancel a running
      // rotation segment by itself; stop it so the globe holds still.
      if (rotationAllowedRef.current) stopRotation();
      const firstAdm0 = async (layer: string) => {
        const result = await map.queryRenderedFeaturesAtPoint(point, [], [layer]);
        return result?.features[0]?.properties as
          { adm0?: string; code?: string | null } | undefined;
      };

      // Only one border level is drawn at any zoom, so at most one of these answers.
      const [wide, tight, coarse, detailed] = await Promise.all([
        firstAdm0(LAYER.smallHitWide),
        firstAdm0(LAYER.smallHitTight),
        firstAdm0(LAYER.countriesCoarseHit),
        firstAdm0(LAYER.countriesDetailedHit),
      ]);
      const country = detailed ?? coarse;
      const hits: TapHits = {
        smallWide: wide?.adm0,
        smallTight: tight?.adm0,
        country: country?.adm0 ? { adm0: country.adm0, code: country.code ?? null } : undefined,
      };

      const result = resolveTap(hits);
      if (result.type === 'select' && countryByAdm0(result.adm0)) {
        dispatch({ type: 'countryTapped', country: { adm0: result.adm0 } });
      } else if (result.type === 'ocean') {
        dispatch({ type: 'oceanTapped' });
      }
    },
    [stopRotation],
  );
  useEffect(() => {
    handleTapRef.current = (point) => void handleTap(point);
  }, [handleTap]);

  // AC-1: the map mounts once the borders file is ready (a fast local copy).
  // The end point is the first time Mapbox is idle — every visible tile,
  // satellite imagery included, loaded and drawn (sprint 1 AC-14a: on an empty
  // cache "map loaded" fired before the imagery). Rotation and the detailed
  // borders wait for it too. If the map never settles, a fallback after
  // "map loaded" keeps the globe from waiting forever.
  // (onDidFinishRenderingMapFully is never sent on Android in @rnmapbox/maps 10.3.)
  useEffect(markGlobeMounted, []);
  const mapReady = Boolean(countries.url || countries.error);
  const globeReady = useRef(false);
  const onGlobeReady = useCallback((reason: 'idle' | 'fallback') => {
    if (globeReady.current) return;
    globeReady.current = true;
    logGlobeReady(reason);
    setMapLoaded(true);
  }, []);
  const onMapIdle = useCallback(() => onGlobeReady('idle'), [onGlobeReady]);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onMapLoaded = useCallback(() => {
    fallbackTimer.current = setTimeout(() => onGlobeReady('fallback'), GLOBE_READY_FALLBACK_MS);
  }, [onGlobeReady]);
  useEffect(() => () => clearTimeout(fallbackTimer.current), []);

  // The Mapbox logo and credits keep their own strip above the controls (sprint 1 design 1).
  const logoPosition = useMemo(
    () => ({ top: insets.top + layout.mapboxLogoTop, left: layout.mapboxLogoLeft }),
    [insets.top],
  );
  const attributionPosition = useMemo(
    () => ({ top: insets.top + layout.mapboxLogoTop, left: layout.mapboxAttributionLeft }),
    [insets.top],
  );

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
      {/* The scene is always space, so the system bars keep light icons (AC-7, AC-9). */}
      <StatusBar style="light" />
      <NavigationBar style="light" />
      <View
        style={StyleSheet.absoluteFill}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        importantForAccessibility={searchOpen ? 'no-hide-descendants' : 'auto'}
        testID="globe-touch-surface"
      >
        {mapReady && (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            projection="globe"
            styleJSON={STYLE_JSON}
            onDidFinishLoadingMap={onMapLoaded}
            onMapIdle={onMapIdle}
            scaleBarEnabled={false}
            compassEnabled={false}
            pitchEnabled={false}
            rotateEnabled={false}
            logoPosition={logoPosition}
            attributionPosition={attributionPosition}
            accessibilityLabel={t('globe.a11yLabel')}
          >
            <Camera
              ref={cameraRef}
              defaultSettings={DEFAULT_CAMERA}
              minZoomLevel={0.8}
              maxZoomLevel={8}
            />
            <GlobeLayers
              countriesUrl={countries.url}
              detailedCountriesUrl={detailedCountries.url}
              oceanMaskUrl={oceanMask.url}
              highlightedAdm0={selectedAdm0}
              reduceMotion={reduceMotion === true}
            />
          </MapView>
        )}
      </View>

      <SystemScrims insetsTop={insets.top} insetsBottom={insets.bottom} />

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.veil, veilStyle]}
      />

      {countries.error && (
        <View style={[styles.banner, { top: insets.top + layout.overlayTop }]} pointerEvents="none">
          <Text style={styles.message}>{t('globe.loadError')}</Text>
        </View>
      )}

      {/* The card steps aside while searching and comes back if nothing is chosen. */}
      {selectedCountry && (
        <BoardingPassCard
          hidden={searchOpen}
          key={selectedCountry.adm0}
          country={selectedCountry}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion === true}
          bottomInset={insets.bottom}
          onClose={() => dispatch({ type: 'backPressed' })}
          onHeight={(height) => {
            cardHeight.current = height;
          }}
        />
      )}

      {(auth.state.status === 'signedOut' || auth.state.status === 'signedIn') && !searchOpen && (
        <AccountButton
          user={auth.state.status === 'signedIn' ? auth.state.user : null}
          colorScheme={colorScheme}
          top={insets.top + layout.chromeRowTop}
          onPress={() => {
            if (rotationAllowedRef.current) stopRotation();
            setAccountSheetOpen(true);
          }}
        />
      )}

      {auth.state.status === 'signedIn' ? (
        <AccountSheet
          visible={accountSheetOpen}
          user={auth.state.user}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion === true}
          insetsBottom={insets.bottom}
          onClose={() => {
            setAccountSheetOpen(false);
            setLastInteractionAt(Date.now());
          }}
        />
      ) : auth.state.status === 'signedOut' ? (
        <SignInSheet
          key={expired ? 'expired' : 'signIn'}
          visible={sheetOpen}
          expired={expired}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion === true}
          insetsBottom={insets.bottom}
          onClose={() => {
            setAccountSheetOpen(false);
            auth.acknowledgeExpiry();
            setLastInteractionAt(Date.now());
          }}
        />
      ) : null}

      {auth.state.status === 'needsConsent' && (
        <ConsentScreen
          need={auth.state.need}
          documents={auth.state.documents}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion === true}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
        />
      )}

      {auth.notice && (
        <Toast
          text={
            auth.notice.kind === 'signedIn'
              ? t('account.signedInAs', { name: auth.notice.name })
              : t('account.signedOut')
          }
          top={insets.top + layout.overlayTop}
          onDone={auth.clearNotice}
        />
      )}

      <SearchBar
        open={searchOpen}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion === true}
        insetsTop={insets.top}
        insetsBottom={insets.bottom}
        onOpen={openSearch}
        onClose={closeSearch}
        onSelect={selectFromSearch}
      />
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
