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
import { AccountSheet } from '@/features/account/AccountSheet';
import { sweepExports } from '@/features/account/exportData';
import { AccountButton } from '@/features/auth/AccountButton';
import { SignInSheet } from '@/features/auth/AccountSheets';
import { useAuth } from '@/features/auth/AuthProvider';
import { ConsentScreen } from '@/features/auth/ConsentScreen';
import { SearchBar } from '@/features/search/SearchBar';
import { CardTrips } from '@/features/trips/CardTrips';
import { MyTripsSheet } from '@/features/trips/MyTripsSheet';
import { TripForm, type TripFormResult, type TripFormTarget } from '@/features/trips/TripForm';
import { TripsButton } from '@/features/trips/TripsButton';
import { useTrips } from '@/features/trips/TripsProvider';
import { flightTracked, OPEN_TIMEOUT_MS, tripOfFlight } from '@/features/flights/flightsStore';
import { PushExplainer } from '@/features/push/PushExplainer';
import { launchedFromAlert, usePushOpen, type AlertText } from '@/features/push/usePushOpen';
import { usePushSetup } from '@/features/push/usePushSetup';
import { supabase } from '@/lib/supabase';
import type { Trip } from '@/features/trips/tripsApi';
import { tripStatus } from '@/features/trips/tripDates';
import { globe, layout, motion } from '@/theme/tokens';

import { BoardingPassCard, CARD_GAP } from './BoardingPassCard';
import { HOME_CENTER, HOME_ZOOM, flightDuration, zoomForSpan } from './camera';
import { countryByAdm0 } from './countryData';
import { GlobeLayers, LAYER } from './GlobeLayers';
import { NEXT_TRIP_HIT, NextTripPin, type NextTripFeature } from './NextTripPin';
import { loadClimate } from '@/features/climate/climateData';
import { hasMapboxToken, turnOffMapboxTelemetryOnce } from './mapbox';
import { logGlobeReady, markGlobeMounted, markMyTripsOpened } from './perfLog';
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

/**
 * AC-10 (Yossi, 2026-10-25): zoom is by pinch only. A double tap no longer
 * zooms, so tapping twice quickly can't select a country and jump the map.
 */
const GESTURES = {
  doubleTapToZoomInEnabled: false,
  doubleTouchToZoomOutEnabled: false,
  quickZoomEnabled: false,
  pinchZoomEnabled: true,
} as const;

/** How long after "map loaded" the globe counts as ready if Mapbox never goes idle. */
const GLOBE_READY_FALLBACK_MS = 5000;

/** How long the coarse borders stay at every zoom if the map doesn't go idle after the detailed ones mount. */
const DETAILED_DRAWN_FALLBACK_MS = 3000;

/** The touch event's own time (ms), falling back to the JS clock. */
function touchTime(event: GestureResponderEvent): number {
  const { timestamp } = event.nativeEvent as { timestamp?: number };
  return typeof timestamp === 'number' && timestamp > 0 ? timestamp : Date.now();
}

/** End-to-end tests (Maestro) build with EXPO_PUBLIC_E2E=1: a still globe at a fixed view. */
const E2E = process.env.EXPO_PUBLIC_E2E === '1';

// The fade is what replaces the flight under reduced motion (AC-6), so it must
// run even then: Reanimated's default (ReduceMotion.System) would snap it to black.
/** The whole lookup of a tapped alert, then "no connection" (sprint 6 design 4.5). */
function withinOpenTimeout<T>(work: Promise<T>): Promise<T | 'offline'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.catch(() => 'offline' as const),
    new Promise<'offline'>((r) => (timer = setTimeout(() => r('offline'), OPEN_TIMEOUT_MS))),
  ]).finally(() => clearTimeout(timer));
}

const VEIL_FADE_OUT = { duration: motion.reduceFadeOut, reduceMotion: ReduceMotion.Never };
const VEIL_FADE_IN = { duration: motion.reduceFadeIn, reduceMotion: ReduceMotion.Never };

type CameraHandle = ComponentRef<typeof Camera>;

/**
 * What a signed-out tap asked for, done once sign-in (and consent) succeeds
 * (sprint 2 design 2.3, 5.2). Dropped on any cancel or sign-out.
 */
type PendingIntent = { type: 'newTrip'; adm0: string } | { type: 'myTrips' } | null;

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
  // Signing in, out or into the consent screen closes whatever sheet led there
  // (design 4.2, 5.2): the next screen is the globe, the consent screen or a toast.
  const [sheetForStatus, setSheetForStatus] = useState(auth.state.status);
  if (sheetForStatus !== auth.state.status) {
    setSheetForStatus(auth.state.status);
    setAccountSheetOpen(false);
  }
  // An expired session opens the sign-in sheet by itself (design 4.2).
  const expired = auth.state.status === 'signedOut' && auth.state.expired;
  const sheetOpen = accountSheetOpen || expired;
  const consentShown = auth.state.status === 'needsConsent';

  // Sprint 2 F-006: trips.
  const trips = useTrips();
  const [myTripsOpen, setMyTripsOpen] = useState(false);
  const [tripForm, setTripForm] = useState<TripFormTarget | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent>(null);
  /** The trip to open in the card, when the card was opened from "My trips" (design 5.3). */
  // seq: every request counts, even for the same trip again (Raz, m1).
  // id null: a request to collapse the open row (after a save, design 8.9).
  const [openTrip, setOpenTrip] = useState<{
    id: string | null;
    adm0: string;
    seq: number;
  } | null>(null);
  const openSeq = useRef(0);
  /** Sprint 6 AC-5: the flight a tapped alert opens, in the open trip's row. */
  const [openFlight, setOpenFlight] = useState<string | null>(null);
  const [alertText, setAlertText] = useState<AlertText | null>(null);
  const [tripToast, setTripToast] = useState<{ text: string; at: number; long?: boolean } | null>(
    null,
  );
  const tripAdm0s = useMemo(
    () => (trips.countries ? [...trips.countries] : null),
    [trips.countries],
  );
  // AC-8: leaving "signed in" closes the trips list at once. The form stays
  // through the consent screen (design 3.4) and closes only on sign-out.
  const [tripsForStatus, setTripsForStatus] = useState(auth.state.status);
  if (tripsForStatus !== auth.state.status) {
    setTripsForStatus(auth.state.status);
    if (auth.state.status !== 'signedIn') setMyTripsOpen(false);
    if (auth.state.status === 'signedOut') {
      setTripForm(null);
      setPendingIntent(null);
    }
  }
  // The first frame is drawn (first idle, or the fallback below). Before
  // that getCenter() answers [0, 0] rather than the default camera, so
  // rotation would jump the globe to 0°,0° (seen on device).
  const [globeReady, setGlobeReady] = useState(false);
  // AC-13a: the detailed borders never compete with the first frame.
  const detailedCountries = useDetailedCountriesAsset(globeReady);
  // The coarse borders stop at zoom 3 only once the detailed ones are drawn:
  // the first idle after they mount, or a fallback (review finding 1).
  const [detailedDrawn, setDetailedDrawn] = useState(false);
  // Start "idle" so the globe begins turning (after the ramp) as soon as it appears.
  const [lastInteractionAt, setLastInteractionAt] = useState(
    () => Date.now() - motion.autoRotateResumeDelay,
  );

  const selectedAdm0 = selection.selected?.adm0 ?? null;
  const selectedCountry = selectedAdm0 ? countryByAdm0(selectedAdm0) : undefined;

  // Any other country, or none, drops it (review): reopening later starts closed.
  if (openTrip && selectedAdm0 !== openTrip.adm0) setOpenTrip(null);

  // Sprint 2 design 2.3: after sign-in (and consent), do what the tap asked for.
  if (auth.state.status === 'signedIn' && pendingIntent) {
    setPendingIntent(null);
    if (pendingIntent.type === 'myTrips') {
      markMyTripsOpened();
      setMyTripsOpen(true);
    } else if (selectedCountry?.adm0 === pendingIntent.adm0) {
      setTripForm({ kind: 'new', country: selectedCountry });
    }
  }

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
    globeReady &&
    reduceMotion === false &&
    !selectedAdm0 &&
    !selection.flying &&
    !fingerDown &&
    !searchOpen &&
    // Design 5.1: the globe holds still behind the consent screen and sheets.
    !sheetOpen &&
    !consentShown &&
    !myTripsOpen &&
    !tripForm;
  // Sprint 3 design 9.4: the pin's pulse runs only while the globe is free,
  // with no idle wait (the reduced-motion check is the pin's own).
  const pulseAllowed =
    !E2E &&
    globeReady &&
    !selectedAdm0 &&
    !selection.flying &&
    !fingerDown &&
    !searchOpen &&
    !sheetOpen &&
    !consentShown &&
    !myTripsOpen &&
    !tripForm;
  const hasPinRef = useRef(false);
  const pinFeature = useMemo((): NextTripFeature | null => {
    const trip = auth.state.status === 'signedIn' ? trips.nextTrip : null;
    const country = trip ? countryByAdm0(trip.countryAdm0) : undefined;
    return trip && country
      ? { adm0: trip.countryAdm0, tripId: trip.id, coordinate: country.label }
      : null;
  }, [auth.state.status, trips.nextTrip]);
  useEffect(() => {
    hasPinRef.current = pinFeature !== null;
  }, [pinFeature]);

  // Sprint 3 AC-8: anything the user does before the trips arrive cancels
  // opening at the active trip.
  const userInteracted = useRef(false);
  /** Set below, once openTripFromList exists; read by the tap handler. */
  const pinTapRef = useRef<(adm0: string, tripId: string) => void>(() => {});
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
    userInteracted.current = true;
    if (touches.length > 1) {
      if (touchDown.current) touchDown.current.multiTouch = true;
      return;
    }
    touchDown.current = { x: pageX, y: pageY, at: touchTime(event), multiTouch: false };
  }, []);
  const onTouchEnd = useCallback((event: GestureResponderEvent) => {
    const { touches, pageX, pageY } = event.nativeEvent;
    if (touches.length > 0) return;
    setFingerDown(false);
    setLastInteractionAt(Date.now());
    const down = touchDown.current;
    touchDown.current = null;
    if (down && isTap(down, { x: pageX, y: pageY, at: touchTime(event) })) {
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
  /** The country opened at the active trip, announced on its own (design 10.2). */
  const quietSelection = useRef<string | null>(null);
  useEffect(() => {
    if (selectedAdm0) {
      hadSelection.current = true;
      const country = countryByAdm0(selectedAdm0);
      // Opening at the active trip makes one announcement of its own (design 10.2).
      if (quietSelection.current === selectedAdm0) quietSelection.current = null;
      else if (country)
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
    userInteracted.current = true;
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
      const firstAdm0 = async (layers: string[]) => {
        const result = await map.queryRenderedFeaturesAtPoint(point, [], layers);
        return result?.features[0]?.properties as
          { adm0?: string; code?: string | null } | undefined;
      };

      // Sprint 3 design 9.5: the pin wins over the countries under it. With
      // no pin, no extra query before the countries (Raz, m6).
      if (hasPinRef.current) {
        try {
          const pin = (await map.queryRenderedFeaturesAtPoint(point, [], [NEXT_TRIP_HIT]))
            ?.features[0]?.properties as { adm0?: string; tripId?: string } | undefined;
          if (pin?.tripId && pin.adm0) {
            pinTapRef.current(pin.adm0, pin.tripId);
            return;
          }
        } catch {
          // No pin layer yet: carry on with the countries.
        }
      }

      let wide, tight, country;
      try {
        // Both border levels in one query: only one is drawn at any zoom.
        [wide, tight, country] = await Promise.all([
          firstAdm0([LAYER.smallHitWide]),
          firstAdm0([LAYER.smallHitTight]),
          firstAdm0([LAYER.countriesCoarseHit, LAYER.countriesDetailedHit]),
        ]);
      } catch (error) {
        console.error('[globe] tap query failed', error);
        return;
      }
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
  const globeReadySent = useRef(false);
  const globeReadyAt = useRef(0);
  const onGlobeReady = useCallback((reason: 'idle' | 'fallback') => {
    if (globeReadySent.current) return;
    globeReadySent.current = true;
    globeReadyAt.current = Date.now();
    logGlobeReady(reason);
    setGlobeReady(true);
  }, []);
  const detailedMounted = Boolean(detailedCountries.url);
  const onMapIdle = useCallback(() => {
    onGlobeReady('idle');
    // Idle after the detailed source mounted means it is parsed and drawn.
    if (detailedMounted) setDetailedDrawn(true);
  }, [onGlobeReady, detailedMounted]);
  useEffect(() => {
    if (!detailedMounted || detailedDrawn) return;
    // The map may not go idle again soon (a flight, rotation); don't wait forever.
    const timer = setTimeout(() => setDetailedDrawn(true), DETAILED_DRAWN_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [detailedMounted, detailedDrawn]);

  // Sprint 2 design 7.5: the trip countries load once the globe is up, not before.
  // Leftovers of an interrupted data export go then too (design 10.5).
  useEffect(() => {
    if (!globeReady) return;
    trips.start();
    sweepExports();
  }, [globeReady, trips]);

  const showTripToast = useCallback(
    (text: string, long?: boolean) => setTripToast({ text, at: Date.now(), long }),
    [],
  );

  // Sprint 6 AC-5: a tapped alert flies to the country, opens the trip row and the flight's sheet.
  const openFromAlert = useCallback(
    async (flightId: string, text: AlertText) => {
      // Slow to find: say the tap was taken (design 4.1).
      const slow = setTimeout(() => showTripToast(t('push.opening')), 3000);
      const found = await withinOpenTimeout(tripOfFlight(flightId));
      if (found === 'offline') {
        clearTimeout(slow);
        showTripToast(t('push.openOffline'), true);
        return;
      }
      const tripId = found === 'gone' ? null : found;
      const known = [...(trips.cache?.upcoming ?? []), ...(trips.cache?.past ?? [])].find(
        (trip) => trip.id === tripId,
      );
      let adm0: string | null | 'offline' = known?.countryAdm0 ?? null;
      if (tripId && !adm0 && supabase) {
        const read = supabase.from('trips').select('country_adm0').eq('id', tripId).maybeSingle();
        const answer = await withinOpenTimeout(
          Promise.resolve(read).then((r) =>
            r.error ? ('offline' as const) : (r.data as { country_adm0: string } | null),
          ),
        );
        // A failed read is "no connection", never "gone" (Raz review 7).
        adm0 = answer === 'offline' ? 'offline' : (answer?.country_adm0 ?? null);
      }
      clearTimeout(slow);
      if (adm0 === 'offline') {
        showTripToast(t('push.openOffline'), true);
        return;
      }
      if (!tripId || !adm0 || !countryByAdm0(adm0)) {
        showTripToast(t('flight.gone'), true);
        return;
      }
      setAlertText(text);
      setMyTripsOpen(false);
      setAccountSheetOpen(false);
      setSearchOpen(false);
      setOpenTrip({ id: tripId, adm0, seq: ++openSeq.current });
      setOpenFlight(`${flightId}:${openSeq.current}`);
      dispatch({ type: 'countryTapped', country: { adm0 } });
    },
    [trips.cache, showTripToast, t],
  );
  // A trip form open: the alert waits for it to close, its work is never thrown away (design 4.2).
  const [heldAlert, setHeldAlert] = useState<{ id: string; text: AlertText } | null>(null);
  useEffect(() => {
    if (!heldAlert || tripForm) return;
    // The form just closed: open the alert's flight now (an outside event, not render).
    const held = heldAlert;
    const timer = setTimeout(() => {
      setHeldAlert(null);
      void openFromAlert(held.id, held.text);
    }, 0);
    return () => clearTimeout(timer);
  }, [heldAlert, tripForm, openFromAlert]);
  usePushOpen({
    ready:
      auth.state.status === 'signedOut' || (auth.state.status === 'signedIn' && trips.firstLoad),
    signedIn: auth.state.status === 'signedIn',
    onOpen: (id, text) => (tripForm ? setHeldAlert({ id, text }) : void openFromAlert(id, text)),
    onSignedOut: () => showTripToast(t('flight.gone'), true),
  });

  // Sprint 6 F-018: the channel, the consent on the server, and the alerts explainer.
  const push = usePushSetup({
    userId: auth.state.status === 'signedIn' ? auth.state.user.id : null,
    ready: globeReady && trips.firstLoad && auth.state.status === 'signedIn',
    // Nothing else on screen: no form, list, sheet, search or consent (design 2.2).
    quiet: !tripForm && !myTripsOpen && !sheetOpen && !searchOpen && !consentShown,
    onToast: showTripToast,
  });
  // A flight saved from the trip form: offered once the form is closed (design 2.3, Raz review 4).
  const [formFlight, setFormFlight] = useState<string | null>(null);
  const offerPush = push.offer;
  useEffect(() => {
    if (!formFlight || tripForm) return;
    const timer = setTimeout(() => {
      setFormFlight(null);
      if (flightTracked(formFlight) === true) void offerPush();
    }, 400);
    return () => clearTimeout(timer);
  }, [formFlight, tripForm, offerPush]);

  const newTrip = useCallback(() => {
    if (!selectedCountry) return;
    if (auth.state.status === 'signedIn') {
      setTripForm({ kind: 'new', country: selectedCountry });
      return;
    }
    setPendingIntent({ type: 'newTrip', adm0: selectedCountry.adm0 });
    setAccountSheetOpen(true);
  }, [auth.state.status, selectedCountry]);

  const openMyTrips = useCallback(() => {
    userInteracted.current = true;
    if (rotationAllowedRef.current) stopRotation();
    if (auth.state.status === 'signedIn') {
      markMyTripsOpened();
      setMyTripsOpen(true);
      return;
    }
    setPendingIntent({ type: 'myTrips' });
    setAccountSheetOpen(true);
  }, [auth.state.status, stopRotation]);

  const tripFormDone = useCallback(
    (result: TripFormResult) => {
      setTripForm(null);
      const { trip } = result;
      if (result.kind === 'deleted') {
        trips.changed({ adm0: trip.countryAdm0, has: null });
        showTripToast(t(result.alreadyGone ? 'tripDelete.alreadyGone' : 'tripDelete.done'));
        return;
      }
      trips.changed({ adm0: trip.countryAdm0, has: true });
      // A new trip or a copy: the open row (a copy's source) closes, and the
      // new row doesn't open by itself (design 8.9, Raz R1).
      if (result.kind === 'created' && selectedAdm0 === trip.countryAdm0)
        setOpenTrip({ id: null, adm0: trip.countryAdm0, seq: ++openSeq.current });
      showTripToast(t(result.kind === 'created' ? 'tripForm.saved' : 'tripForm.updated'));
      AccessibilityInfo.announceForAccessibility(t('tripForm.savedA11y', { name: trip.title }));
    },
    [trips, selectedAdm0, showTripToast, t],
  );

  const openTripFromList = useCallback(
    (trip: Trip) => {
      setMyTripsOpen(false);
      setOpenTrip({ id: trip.id, adm0: trip.countryAdm0, seq: ++openSeq.current });
      if (countryByAdm0(trip.countryAdm0)) {
        dispatch({ type: 'countryTapped', country: { adm0: trip.countryAdm0 } });
      }
      AccessibilityInfo.announceForAccessibility(t('trips.opened', { name: trip.title }));
    },
    [t],
  );

  // Sprint 3 AC-7: a tap on the pin is a tap on that trip in My trips; on
  // the country already open, the trip just opens in the card.
  useEffect(() => {
    pinTapRef.current = (adm0, tripId) => {
      if (selectedAdm0 === adm0) {
        setOpenTrip({ id: tripId, adm0, seq: ++openSeq.current });
        return;
      }
      if (trips.nextTrip?.id === tripId) openTripFromList(trips.nextTrip);
    };
  }, [selectedAdm0, trips.nextTrip, openTripFromList]);

  // Sprint 3 AC-8: a cold start, signed in with current consent, the trips
  // within 3 s of the globe, nothing touched yet, and an active trip: open
  // it, once. Decided once, on the first answer.
  const autoDecided = useRef(false);
  // Asked to accept the documents again at launch: nothing opens (design 10.1, Raz m7).
  useEffect(() => {
    if (auth.state.status === 'needsConsent') autoDecided.current = true;
  }, [auth.state.status]);
  // Opened from an alert: the alert wins (sprint 6 design 4.1 step 4).
  useEffect(() => {
    void launchedFromAlert().then((fromAlert) => {
      if (fromAlert) autoDecided.current = true;
    });
  }, []);
  useEffect(() => {
    if (autoDecided.current || !globeReady || !trips.firstLoad || auth.state.status !== 'signedIn')
      return;
    autoDecided.current = true;
    if (userInteracted.current || Date.now() - globeReadyAt.current > 3000) return;
    const trip = trips.nextTrip;
    if (!trip || tripStatus(trip.startDate, trip.endDate, trips.today) !== 'active') return;
    if (!countryByAdm0(trip.countryAdm0)) return;
    quietSelection.current = trip.countryAdm0;
    // Once per launch, on the first answer from the server: it reacts to
    // that answer, so it can't happen during render.
    setOpenTrip({ id: trip.id, adm0: trip.countryAdm0, seq: ++openSeq.current });
    dispatch({ type: 'countryTapped', country: { adm0: trip.countryAdm0 } });
    AccessibilityInfo.announceForAccessibility(t('activeTrip.opened', { name: trip.title }));
  }, [globeReady, trips.firstLoad, trips.nextTrip, trips.today, auth.state.status, t]);

  // Sprint 3 AC-12: the climate file loads once the globe is up, not before
  // the first frame and not while the first card animates in (Raz, T3).
  useEffect(() => {
    if (!globeReady) return;
    const timer = setTimeout(() => void loadClimate().catch(() => {}), 1000);
    return () => clearTimeout(timer);
  }, [globeReady]);

  // AC-14: Mapbox usage telemetry off. On Android this builds a throwaway
  // map view, so it waits for the globe to be up (review finding 6).
  useEffect(() => {
    if (globeReady) turnOffMapboxTelemetryOnce();
  }, [globeReady]);
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
      {/* Dark icons over the light consent screen (WCAG 1.4.11, sprint 1 QA). */}
      <StatusBar style={consentShown && colorScheme === 'light' ? 'dark' : 'light'} />
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
            gestureSettings={GESTURES}
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
              detailedDrawn={detailedDrawn}
              oceanMaskUrl={oceanMask.url}
              highlightedAdm0={selectedAdm0}
              reduceMotion={reduceMotion === true}
              tripAdm0s={tripAdm0s}
            />
            <NextTripPin
              feature={pinFeature}
              pulseAllowed={pulseAllowed}
              reduceMotion={reduceMotion !== false}
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
          topInset={insets.top}
          today={trips.today}
          coupon={
            auth.state.status === 'signedIn' ||
            auth.state.status === 'signedOut' ||
            auth.state.status === 'needsConsent'
              ? (maxListHeight, onNoticeHeight) => (
                  <CardTrips
                    country={selectedCountry}
                    colorScheme={colorScheme}
                    maxListHeight={maxListHeight}
                    onNoticeHeight={onNoticeHeight}
                    initiallyOpen={openTrip?.id ?? null}
                    openSeq={openTrip?.seq ?? 0}
                    openFlight={openFlight}
                    alertText={alertText}
                    onAlertFlightShown={() => setOpenFlight(null)}
                    onTrackedFlightSaved={() => void push.offer()}
                    onNewTrip={newTrip}
                    onDuplicateTrip={(source) =>
                      setTripForm({ kind: 'duplicate', country: selectedCountry, source })
                    }
                    onEditTrip={(trip) =>
                      setTripForm({ kind: 'edit', country: selectedCountry, trip })
                    }
                    onToast={showTripToast}
                  />
                )
              : undefined
          }
          onClose={() => {
            dispatch({ type: 'backPressed' });
          }}
          onHeight={(height) => {
            cardHeight.current = height;
          }}
        />
      )}

      {(auth.state.status === 'signedOut' || auth.state.status === 'signedIn') && !searchOpen && (
        <AccountButton
          user={
            auth.state.status === 'signedIn'
              ? { ...auth.state.user, name: auth.displayName ?? auth.state.user.name }
              : null
          }
          colorScheme={colorScheme}
          top={insets.top + layout.chromeRowTop}
          onPress={() => {
            userInteracted.current = true;
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
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onToast={showTripToast}
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
          reason={pendingIntent?.type ?? null}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion === true}
          insetsBottom={insets.bottom}
          onClose={() => {
            setAccountSheetOpen(false);
            // Design 2.3: closing sign-in drops what it was for; the card stays.
            setPendingIntent(null);
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

      <TripsButton
        visible={
          (auth.state.status === 'signedIn' || auth.state.status === 'signedOut') &&
          !selectedAdm0 &&
          !searchOpen &&
          !sheetOpen &&
          !myTripsOpen &&
          !tripForm
        }
        colorScheme={colorScheme}
        reduceMotion={reduceMotion === true}
        bottomInset={insets.bottom}
        onPress={openMyTrips}
      />

      <MyTripsSheet
        visible={myTripsOpen}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion === true}
        insetsTop={insets.top}
        insetsBottom={insets.bottom}
        onClose={() => {
          setMyTripsOpen(false);
          setLastInteractionAt(Date.now());
        }}
        onOpenTrip={openTripFromList}
      />

      {tripForm && (
        <TripForm
          key={
            tripForm.kind === 'edit'
              ? tripForm.trip.id
              : tripForm.kind === 'duplicate'
                ? 'dup-' + tripForm.source.id
                : 'new-' + tripForm.country.adm0
          }
          target={tripForm}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion === true}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onClose={() => setTripForm(null)}
          onGone={() => trips.changed({ adm0: tripForm.country.adm0, has: null })}
          onFlightSaved={setFormFlight}
          onDone={tripFormDone}
        />
      )}

      {tripToast && !tripForm && (
        <Toast
          key={tripToast.at}
          text={tripToast.text}
          long={tripToast.long}
          top={insets.top + layout.overlayTop}
          onDone={() => setTripToast(null)}
        />
      )}

      <PushExplainer
        visible={push.visible}
        number={push.number}
        androidNote={push.androidNote}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion === true}
        insetsBottom={insets.bottom}
        onAllow={push.allow}
        onLater={push.later}
      />

      {/* Design 2.3: "signed in as" waits until the trip form closes. */}
      {/* One toast at a time: the trip's first, then "signed in as" (review). */}
      {auth.notice && !tripForm && !tripToast && (
        <Toast
          text={
            auth.notice.kind === 'signedIn'
              ? t('account.signedInAs', { name: auth.notice.name })
              : auth.notice.kind === 'deleted'
                ? t('deleteAccount.done')
                : t('account.signedOut')
          }
          long={auth.notice.kind === 'deleted'}
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
