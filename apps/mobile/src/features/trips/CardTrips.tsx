/**
 * The coupon under the boarding pass (sprint 2 design 2): this country's
 * trips and "New trip". A row opens one at a time, with the notes, "Edit" and
 * "Delete" (AC-4, AC-6), and only in the card's Trips mode, where the trips
 * take the whole card (fix my-trips-space, ADR-017). Asks the server only when the countries
 * set says there are trips here, or isn't known yet (design 2.2, AC-10).
 */
import NetInfo from '@react-native-community/netinfo';
import {
  useEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactElement,
  useContext,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';

import { Button } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { ScrollFade, useMoreBelow } from '@/components/ScrollFade';
import {
  ChevronDownIcon,
  CloudOffIcon,
  CopyIcon,
  PencilIcon,
  PeopleIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { TripTemperature } from '@/features/climate/TripTemperature';
import { useDestination } from '@/features/destination/destinationData';
import { PassportBanners } from '@/features/kit/PassportBanners';
import { TripStatusLine } from '@/features/destination/DestinationFields';
import { FlightsSection } from '@/features/flights/FlightsSection';
import { tripHasFlights } from '@/features/flights/flightsStore';
import { tripHasKit } from '@/features/kit/kitStore';
import { TripKitSections } from '@/features/kit/TripKitSections';
import { isolateOwn, OuterScrollContext } from '@/features/globe/BoardingPassCard';
import type { CountryInfo } from '@/features/globe/countryData';
import { colors, fonts, layout, motion, radius, timing, type ColorScheme } from '@/theme/tokens';

import { countryName } from './countryName';
import {
  formatRange,
  formatRangeA11y,
  travelerCount,
  tripStatus,
  type TripStatus,
} from './tripDates';
import { deleteTrip, type Trip } from './tripsApi';
import { useTrips } from './TripsProvider';
import { cachedWhen } from './tripsCache';
import { useTripList } from './useTripList';

interface Props {
  country: CountryInfo;
  colorScheme: ColorScheme;
  /** How tall the trips list may grow before it scrolls (design 2.1: the card stays below the controls). */
  maxListHeight: number;
  /** The offline notice's height, 0 when hidden: the card sizes the list with it (design 1.2). */
  onNoticeHeight?: (height: number) => void;
  /** Opened from "My trips": this trip starts expanded (design 5.3). */
  initiallyOpen?: string | null;

  /** Bumped on each request to open initiallyOpen, so the same trip opens again (the pin). */
  openSeq?: number;
  onNewTrip: () => void;
  onEditTrip: (trip: Trip) => void;
  /** Sprint 3 AC-9: a new trip to the same country, copied without dates. */
  onDuplicateTrip: (trip: Trip) => void;
  onToast: (text: string) => void;
  /** "flightId:seq": a tapped alert's flight, opened in the open trip (sprint 6 AC-5). */
  openFlight?: string | null;
  /** That alert's text, for an offline copy (sprint 6 design 4.4). */
  alertText?: { title: string; body: string } | null;
  onAlertFlightShown?: () => void;
  /** A tracked flight saved: the alerts explainer may follow (sprint 6 design 2.2). */
  onTrackedFlightSaved?: () => void;
  /** Fix my-trips-space 2.1: the card's Trips mode, as on screen. */
  tripsMode?: boolean;
  /** Enters (a row or the heading) or leaves (no rows left) Trips mode; GlobeScreen owns it. */
  onTripsMode?: (on: boolean) => void;
  /** Sprint 12 AC-12 (design 2.4): the card's Trips-mode fade, for this coupon's content. */
  fade?: SharedValue<number>;
  /** Sprint 12 AC-13: the card has finished coming in. */
  entered?: boolean;
}

export function CardTrips({
  country,
  colorScheme,
  maxListHeight,
  onNoticeHeight,
  initiallyOpen = null,
  openSeq = 0,
  onNewTrip,
  onEditTrip,
  onDuplicateTrip,
  onToast,
  openFlight = null,
  alertText = null,
  onAlertFlightShown,
  onTrackedFlightSaved,
  tripsMode = false,
  onTripsMode,
  fade,
  entered = true,
}: Props) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];
  const { state: auth } = useAuth();
  const trips = useTrips();
  const destination = useDestination();
  const signedIn = auth.status === 'signedIn';
  // Design 2.2: the countries set already says "no trips here": no query, no skeleton.
  const knownEmpty = trips.countries !== null && !trips.countries.has(country.adm0);
  const { state, reload, loadMore } = useTripList({
    enabled: signedIn && !knownEmpty,
    countryAdm0: country.adm0,
    // A new day moves trips between upcoming and past (design 3.4, Raz m2).
    reloadKey: `${trips.changes}:${trips.today}`,
    cache: trips.cache,
  });
  // Sprint 4 F-015: offline with the saved copy, every write is blocked (AC-14, design 10.3).
  const readOnly = trips.fromCache || state.fromCache === true;
  const showsCached = readOnly && trips.cache !== null;
  useEffect(() => {
    if (!showsCached) onNoticeHeight?.(0);
  }, [showsCached, onNoticeHeight]);
  const [blockedAt, setBlockedAt] = useState<string | null>(null);
  if (!readOnly && blockedAt !== null) setBlockedAt(null);
  const guard = (at: string, action: () => void) => () => {
    if (readOnly) setBlockedAt(at);
    else action();
  };
  const [open, setOpen] = useState<string | null>(initiallyOpen);
  // A new request opens the row again, even for the same trip (Raz, m1).
  const request = `${initiallyOpen ?? ''}:${openSeq}`;
  // Sprint 12 AC-13 (design 3.2): a card that opens straight in Trips mode, or a
  // new request while it is already there, sends the focus once. Whether the
  // request came with a flight is kept from its first sight (Raz 5).
  const withFlight = openFlight?.endsWith(`:${openSeq}`) === true;
  const [focusRequest, setFocusRequest] = useState<{
    request: string;
    withFlight: boolean;
    /** The trip was already open: its head is laid out and stays (a repeat tap, Raz). */
    wasOpen: boolean;
  } | null>(() =>
    tripsMode && initiallyOpen !== null ? { request, withFlight, wasOpen: false } : null,
  );
  const [measuredFor, setMeasuredFor] = useState<string | null>(null);
  // Fix my-trips-space 2.1: leaving Trips mode closes the open row.
  const [wasTripsMode, setWasTripsMode] = useState(tripsMode);
  const [askedOpen, setAskedOpen] = useState(request);
  if (askedOpen !== request) {
    setAskedOpen(request);
    setOpen(initiallyOpen);
    if (tripsMode && wasTripsMode && initiallyOpen !== null)
      setFocusRequest({ request, withFlight, wasOpen: open === initiallyOpen });
  }
  // 6.2: focus goes to the open row on the way in, back to it on the way out.
  const [focusTarget, setFocusTarget] = useState<{ id: string | null; n: number } | null>(null);
  if (wasTripsMode !== tripsMode) {
    setWasTripsMode(tripsMode);
    setFocusTarget({ id: open, n: (focusTarget?.n ?? 0) + 1 });
    if (!tripsMode) setOpen(null);
  }
  // A row opens only in Trips mode (2.2): during the fade in, nothing opens early.
  const openId = tripsMode ? open : null;
  const reduceMotion = useReducedMotion();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<{ id: string; text: string } | null>(null);
  const today = trips.today;

  // Announce loading only once it lasts (design 2.2).
  useEffect(() => {
    if (state.showSkeleton) AccessibilityInfo.announceForAccessibility(t('card.trips.loading'));
  }, [state.showSkeleton, t]);

  // The trip opened from "My trips" scrolls into view once its row is laid out.
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrolledTo = useRef<string | null>(null);
  // The card's scroll, in scroll mode (sprint 4 design 1.3): the list itself doesn't scroll.
  const outer = useContext(OuterScrollContext);
  // The row can be laid out before the list: scroll once both are measured (Raz, S4-m15).
  /** Sprint 12 (4f, Raz 4): the list sits in the fading wrapper; its top is the sum of both. */
  const wrapperTop = useRef<number | null>(null);
  const listY = useRef<number | null>(null);
  const listTop = () =>
    wrapperTop.current === null || listY.current === null
      ? null
      : wrapperTop.current + listY.current;
  /** A row asked for before both were measured scrolls once they are. */
  const scrollPending = () => {
    const top = listTop();
    if (!outer || top === null || pendingRowY.current === null) return;
    outer.scrollToRow(top + pendingRowY.current);
    pendingRowY.current = null;
  };
  const pendingRowY = useRef<number | null>(null);
  const rowY = useRef(new Map<string, number>());
  const tapScroll = useRef<string | null>(null);
  useEffect(() => {
    // Raz 1: leaving Trips mode drops a scroll still waiting.
    if (!tripsMode) tapScroll.current = null;
    if (!tripsMode || outer || tapScroll.current === null || tapScroll.current !== open) return;
    const y = rowY.current.get(open);
    tapScroll.current = null;
    if (y === undefined) return;
    // 3.4: once the transition is over.
    const timer = setTimeout(
      () => scroll.current?.scrollTo({ y, animated: !reduceMotion }),
      motion.cardTripsModeFade,
    );
    return () => clearTimeout(timer);
  }, [tripsMode, open, outer, reduceMotion]);
  const onRowLayout = (id: string, y: number) => {
    rowY.current.set(id, y);
    if (focusRequest !== null && id === initiallyOpen && measuredFor !== focusRequest.request) {
      setMeasuredFor(focusRequest.request);
    }
    if (id !== initiallyOpen || scrolledTo.current === request) return;
    scrolledTo.current = request;
    // In scroll mode the card scrolls, not the list (design 1.3).
    if (!outer) scroll.current?.scrollTo({ y, animated: false });
    else {
      pendingRowY.current = y;
      scrollPending();
    }
  };
  // Scroll mode: the card's scroll nearing its end loads the next page (Raz, change 4).
  const nearEnd = outer?.nearEnd ?? 0;
  useEffect(() => {
    if (nearEnd > 0 && !readOnly) void loadMore();
  }, [nearEnd, readOnly, loadMore]);

  const contentStyle = useAnimatedStyle(() => ({ opacity: fade ? fade.value : 1 }));
  // 4g: "New trip" fades only in scroll mode, where it has no fixed place.
  const scrollMode = outer !== undefined;
  const ctaStyle = useAnimatedStyle(() => ({ opacity: scrollMode && fade ? fade.value : 1 }));

  // Sprint 12 P-4: the fade at the list's bottom while more is below.
  const moreBelow = useMoreBelow();
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Raz 12: before the offline return, so a read-only list still updates it.
    moreBelow.onScroll(event);
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    // Offline: no "load more" at all (design 10.4, Raz S4-m8).
    if (readOnly) return;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 48) void loadMore();
  };

  const remove = (trip: Trip) => {
    // Design 8.3: the flights go with the trip, and the dialog says so.
    const body = t('tripDelete.body', { name: trip.title });
    Alert.alert(
      t('tripDelete.title'),
      tripHasKit(trip.id)
        ? `${body} ${t('tripDelete.bodyKit')}`
        : tripHasFlights(trip.id)
          ? `${body} ${t('tripDelete.bodyFlights')}`
          : body,
      [
        { text: t('tripDelete.cancel'), style: 'cancel' },
        {
          text: t('tripDelete.confirm'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const net = await NetInfo.fetch();
              if (net.isConnected === false) {
                setRowNotice({ id: trip.id, text: t('tripDelete.offline') });
                return;
              }
              setDeleting(trip.id);
              setRowNotice(null);
              let timer: ReturnType<typeof setTimeout> | undefined;
              const result = await Promise.race([
                deleteTrip(trip.id),
                new Promise<'error'>((resolve) => {
                  timer = setTimeout(() => resolve('error'), timing.tripSaveTimeout);
                }),
              ]).finally(() => clearTimeout(timer));
              setDeleting(null);
              if (result === 'ok' || result === 'gone') {
                setOpen(null);
                const left = state.upcoming.length + state.past.length - 1;
                trips.changed({
                  adm0: country.adm0,
                  // Unknown while more pages exist; the server answers right after.
                  has: left > 0 ? true : state.hasMore ? null : false,
                });
                onToast(t(result === 'gone' ? 'tripDelete.alreadyGone' : 'tripDelete.done'));
              } else {
                setRowNotice({
                  id: trip.id,
                  text: t(result === 'offline' ? 'tripDelete.offline' : 'tripDelete.error'),
                });
              }
            })();
          },
        },
      ],
    );
  };

  const hasRows = state.upcoming.length + state.past.length > 0;
  const both = state.upcoming.length > 0 && state.past.length > 0;

  // 2.3: no rows and no trip still on its way (loading, an error or offline
  // with one asked for): back to the icons.
  const waiting = initiallyOpen !== null && state.status !== 'ready' && state.status !== 'idle';
  const newTripRef = useRef<ComponentRef<typeof Pressable>>(null);
  useEffect(() => {
    if (!tripsMode || hasRows || waiting) return;
    onTripsMode?.(false);
    if (newTripRef.current) AccessibilityInfo.sendAccessibilityEvent(newTripRef.current, 'focus');
  }, [tripsMode, hasRows, waiting, onTripsMode]);

  const heads = useRef(new Map<string, ComponentRef<typeof Pressable>>());
  const headingRef = useRef<ComponentRef<typeof View>>(null);
  // AC-13 (design 3.3): once the card is in and the row measured. The ref is read now:
  // the head remounts as it becomes sticky.
  /** The request the focus was sent (or deliberately not sent) for: once each. */
  const focusDone = useRef<string | null>(null);
  useEffect(() => {
    if (focusRequest === null || focusDone.current === focusRequest.request) return;
    // Raz 1: leaving Trips mode ends the request; a later layout never sends it.
    if (!tripsMode || focusRequest.request !== request) {
      focusDone.current = focusRequest.request;
      return;
    }
    if (!entered) return;
    if (focusRequest.withFlight) {
      // The flight sheet takes the focus (sprint 6); nothing steals it.
      focusDone.current = request;
      return;
    }
    const id = initiallyOpen;
    const inList =
      id !== null &&
      (state.upcoming.some((x) => x.id === id) || state.past.some((x) => x.id === id));
    let node: ComponentRef<typeof Pressable> | ComponentRef<typeof View> | null | undefined;
    if (inList) {
      // The open trip asked for again (a repeat tap on the pin) has no new layout to wait
      // for; another trip waits for its head, which remounts as it becomes sticky.
      if (measuredFor !== request && !(focusRequest.wasOpen && rowY.current.has(id))) return;
      node = heads.current.get(id);
    } else if (state.status === 'ready') {
      node = headingRef.current;
    } else if (state.status === 'error' || state.status === 'offline') {
      // The message is a live region and says it.
      focusDone.current = request;
      return;
    } else {
      return;
    }
    focusDone.current = request;
    if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  }, [focusRequest, request, tripsMode, entered, initiallyOpen, state, measuredFor]);

  useEffect(() => {
    if (!focusTarget) return;
    const node =
      (focusTarget.id !== null ? heads.current.get(focusTarget.id) : undefined) ??
      headingRef.current;
    if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  }, [focusTarget]);

  /** 2.2: into Trips mode, with this trip open and scrolled to the top of the list. */
  const enterWith = (id: string | null) => {
    setRowNotice(null);
    setOpen(id);
    tapScroll.current = id;
    onTripsMode?.(true);
  };

  /** Every direct child of the list, so the sticky indices count them all (Raz b). */
  const children: ReactElement[] = [];
  let stickyHead = -1;
  const rows = (list: Trip[]) => {
    for (const trip of list) {
      const expanded = openId === trip.id;
      const status = tripStatus(trip.startDate, trip.endDate, today);
      const active = status === 'active';
      const dates = formatRange(trip.startDate, trip.endDate, t);
      const people = travelerCount(trip.travelers);
      if (expanded) stickyHead = children.length;
      children.push(
        <View
          key={`head-${trip.id}`}
          onLayout={(e) => onRowLayout(trip.id, e.nativeEvent.layout.y)}
          style={[
            styles.rowWrap,
            expanded && {
              backgroundColor: palette.openRow,
              borderTopLeftRadius: radius.md,
              borderTopRightRadius: radius.md,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: palette.borderSubtle,
            },
          ]}
        >
          {active ? (
            <View style={[styles.activeBar, { backgroundColor: palette.activeBar }]} />
          ) : null}
          <Pressable
            ref={(node) => {
              if (node) heads.current.set(trip.id, node);
              else heads.current.delete(trip.id);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded, disabled: deleting === trip.id }}
            accessibilityLabel={t(people >= 2 ? 'trips.rowA11yTravelers' : 'trips.rowA11yStatus', {
              name: trip.title,
              dates: formatRangeA11y(trip.startDate, trip.endDate, t),
              status: t(`trips.status.${status}`),
              n: people,
            })}
            accessibilityHint={tripsMode ? undefined : t('card.trips.rowOpenHint')}
            disabled={deleting === trip.id}
            onPress={() => {
              // 2.2: in the destination view a row never opens in place.
              if (!tripsMode) return enterWith(trip.id);
              setRowNotice(null);
              setOpen(expanded ? null : trip.id);
              // Raz 2: the head remounts as it becomes (or stops being) sticky.
              setFocusTarget({ id: trip.id, n: (focusTarget?.n ?? 0) + 1 });
            }}
            style={({ pressed }) => [
              styles.row,
              pressed && !expanded && { backgroundColor: palette.pressed },
            ]}
            testID={`card-trip-${trip.id}`}
          >
            <View style={styles.rowText}>
              <Text
                style={[styles.bodyStrong, { color: palette.textPrimary }]}
                numberOfLines={2}
                maxFontSizeMultiplier={2}
              >
                {trip.title}
              </Text>
              <Text style={[styles.footnote, styles.tabular, { color: palette.textSecondary }]}>
                {dates}
              </Text>
              <View style={styles.meta} importantForAccessibility="no-hide-descendants">
                <StatusTag status={status} colorScheme={colorScheme} />
                {people >= 2 ? (
                  <View style={styles.people}>
                    <PeopleIcon color={palette.textSecondary} />
                    <Text style={[styles.footnote, { color: palette.textSecondary }]}>
                      {t('trips.travelers', { n: people })}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
            {deleting === trip.id ? (
              <ActivityIndicator size={20} color={palette.textTertiary} />
            ) : (
              <View style={expanded ? styles.flipped : undefined}>
                <ChevronDownIcon color={palette.textTertiary} />
              </View>
            )}
          </Pressable>
        </View>,
      );
      if (!expanded) continue;
      children.push(
        <View
          key={`details-${trip.id}`}
          style={[
            styles.details,
            {
              backgroundColor: palette.openRow,
              borderBottomLeftRadius: radius.md,
              borderBottomRightRadius: radius.md,
            },
          ]}
        >
          {/* Sprint 10 design 6.2: the passports first, red, orange, then the reminder. */}
          <PassportBanners
            trip={trip}
            advisories={destination.data?.advisories}
            today={today}
            colorScheme={colorScheme}
            onToast={onToast}
          />
          {/* Sprint 4 design 8: entry and NSC warning first, not tappable. */}
          <TripStatusLine
            advisory={destination.data?.advisories.get(trip.countryAdm0)}
            colorScheme={colorScheme}
          />
          {/* Sprint 5 design 9.1: flights after the status line, before the cities. */}
          <FlightsSection
            trip={trip}
            colorScheme={colorScheme}
            readOnly={readOnly}
            onToast={onToast}
            openFlight={openFlight}
            alertText={alertText}
            onAlertFlightShown={onAlertFlightShown}
            onTrackedFlightSaved={onTrackedFlightSaved}
          />
          {/* Sprint 8 design 2.1: hotels, insurance and emergency after the flights. */}
          <TripKitSections
            trip={trip}
            readOnly={readOnly}
            today={today}
            colorScheme={colorScheme}
            onToast={onToast}
          />
          {trip.cities.length > 0 ? (
            <View
              accessible
              accessibilityLabel={t('card.trips.citiesA11y', {
                list: trip.cities.map((city) => city.name).join(', '),
              })}
            >
              <Text style={[styles.caption, { color: palette.textSecondary }]}>
                {t('card.trips.cities')}
              </Text>
              <Text style={[styles.callout, { color: palette.textPrimary }]}>
                {trip.cities.map((city) => isolateOwn(city.name)).join(' · ')}
              </Text>
            </View>
          ) : null}
          <TripTemperature
            countryAdm0={trip.countryAdm0}
            startDate={trip.startDate}
            endDate={trip.endDate}
            cities={trip.cities}
            colorScheme={colorScheme}
          />
          {trip.notes ? <Notes text={trip.notes} colorScheme={colorScheme} /> : null}
          {rowNotice?.id === trip.id ? (
            <InlineNotice text={rowNotice.text} colorScheme={colorScheme} />
          ) : null}
          {blockedAt === trip.id ? (
            <InlineNotice
              text={t('offline.readOnly')}
              colorScheme={colorScheme}
              testID="card-trip-readonly"
            />
          ) : null}
          <View style={styles.actions}>
            <Button
              kind="secondary"
              outlined={colorScheme === 'dark'}
              label={t('card.trips.edit')}
              icon={(color) => <PencilIcon color={color} size={20} />}
              disabled={deleting !== null}
              blocked={readOnly}
              onPress={guard(trip.id, () => onEditTrip(trip))}
              colorScheme={colorScheme}
              testID="card-trip-edit"
            />
            <Button
              kind="text"
              label={t('card.trips.duplicate')}
              icon={(color) => <CopyIcon color={color} size={20} />}
              disabled={deleting !== null}
              blocked={readOnly}
              onPress={guard(trip.id, () => onDuplicateTrip(trip))}
              colorScheme={colorScheme}
              testID="card-trip-duplicate"
            />
            <Button
              kind="text"
              label={t('card.trips.delete')}
              icon={(color) => <TrashIcon color={color} size={20} />}
              disabled={deleting !== null}
              blocked={readOnly}
              onPress={guard(trip.id, () => remove(trip))}
              colorScheme={colorScheme}
              testID="card-trip-delete"
            />
          </View>
        </View>,
        // The next sticky child: it pushes the open head off at its trip's end (Raz b).
        <View key={`end-${trip.id}`} style={styles.pusher} testID="card-trip-end" />,
      );
    }
  };

  if (both) {
    children.push(
      <Text
        key="upcoming"
        style={[styles.caption, styles.section, { color: palette.textTertiary }]}
      >
        {t('card.trips.upcoming')}
      </Text>,
    );
  }
  rows(state.upcoming);
  if (both) {
    children.push(
      <Text key="past" style={[styles.caption, styles.section, { color: palette.textTertiary }]}>
        {t('card.trips.past')}
      </Text>,
    );
  }
  rows(state.past);
  if (readOnly && trips.cache?.full) {
    children.push(
      <Text key="later" style={[styles.footnote, { color: palette.textTertiary }]}>
        {t('offline.moreLater')}
      </Text>,
    );
  }
  if (state.loadingMore) {
    children.push(
      <View key="loading" style={styles.more}>
        <ActivityIndicator size={20} color={palette.textTertiary} />
      </View>,
    );
  } else if (state.moreError && !readOnly) {
    children.push(
      <View key="moreError" style={styles.message}>
        <Text style={[styles.footnote, { color: palette.textSecondary }]}>
          {t('myTrips.moreError')}
        </Text>
        <Button
          kind="text"
          label={t('card.trips.retry')}
          onPress={() => void loadMore()}
          colorScheme={colorScheme}
        />
      </View>,
    );
  }
  // 3.3: the open head and its pusher; none in scroll mode, where the card scrolls.
  const sticky = tripsMode && !outer && stickyHead >= 0 ? [stickyHead, stickyHead + 2] : [];

  return (
    <View style={[styles.coupon, tripsMode && styles.fill]} testID="card-trips">
      {/* Sprint 12 AC-12 (4e): one wrapper, always mounted, fades with the card. */}
      <Animated.View
        style={[tripsMode && styles.fadeFill, contentStyle]}
        onLayout={(event) => {
          wrapperTop.current = event.nativeEvent.layout.y;
          scrollPending();
        }}
        testID="card-trips-content"
      >
        {hasRows ? (
          // 3.2: in the destination view, the heading opens Trips mode; one trip opens with it.
          tripsMode ? (
            // Raz: the wrapper is the accessible header, so focus can land on it (6.2).
            <View
              ref={headingRef}
              accessible
              accessibilityRole="header"
              accessibilityLabel={t('card.trips.title')}
              style={styles.heading}
              testID="card-trips-heading"
            >
              <Text style={[styles.headingText, { color: palette.textPrimary }]}>
                {t('card.trips.title')}
              </Text>
            </View>
          ) : (
            <Pressable
              ref={headingRef}
              accessibilityRole="button"
              accessibilityHint={t('card.trips.showAllHint')}
              hitSlop={{ top: layout.cardTripsHeadingSlop, bottom: layout.cardTripsHeadingSlop }}
              onPress={() => {
                const all = [...state.upcoming, ...state.past];
                enterWith(all.length === 1 && !state.hasMore ? all[0]!.id : null);
              }}
              style={({ pressed }) => [
                styles.heading,
                pressed && { backgroundColor: palette.pressed },
              ]}
              testID="card-trips-heading"
            >
              <Text style={[styles.headingText, { color: palette.textPrimary }]}>
                {t('card.trips.title')}
              </Text>
              <View style={styles.flipped}>
                <ChevronDownIcon color={palette.textTertiary} />
              </View>
            </Pressable>
          )
        ) : null}
        {showsCached && trips.cache ? (
          <View
            style={[styles.message, styles.offline]}
            accessibilityLiveRegion="polite"
            onLayout={(event) => onNoticeHeight?.(event.nativeEvent.layout.height)}
          >
            <CloudOffIcon color={palette.textTertiary} size={16} />
            <Text
              style={[styles.footnote, styles.grow, { color: palette.textSecondary }]}
              testID="card-trips-cached"
            >
              {t('offline.cachedAt', { when: cachedWhen(trips.cache.savedAt, t) })}
            </Text>
          </View>
        ) : null}

        {state.status === 'loading' && state.showSkeleton ? (
          <Skeleton colorScheme={colorScheme} />
        ) : state.status === 'error' ? (
          <View style={styles.message} accessibilityLiveRegion="polite">
            <Text style={[styles.footnote, { color: palette.textSecondary }]}>
              {t('card.trips.error')}
            </Text>
            <Button
              kind="text"
              label={t('card.trips.retry')}
              onPress={() => void reload()}
              colorScheme={colorScheme}
            />
          </View>
        ) : state.status === 'offline' ? (
          <View style={[styles.message, styles.offline]} accessibilityLiveRegion="polite">
            <CloudOffIcon color={palette.textTertiary} size={20} />
            <Text style={[styles.footnote, styles.grow, { color: palette.textSecondary }]}>
              {t('card.trips.offline')}
            </Text>
          </View>
        ) : null}

        {hasRows ? (
          // P-4 (Raz 13): the list and its fade share a wrapper, which takes the
          // height limit and gives way in Trips mode, so "New trip" stays in.
          <View
            onLayout={(event) => {
              listY.current = event.nativeEvent.layout.y;
              scrollPending();
            }}
            style={
              outer
                ? undefined
                : [
                    { maxHeight: Math.max(maxListHeight, layout.tripRowMin) },
                    // Raz 3: in Trips mode the list gives way, so "New trip" is never pushed out.
                    tripsMode && styles.shrink,
                  ]
            }
          >
            <ScrollView
              ref={scroll}
              scrollEnabled={!outer}
              style={outer ? undefined : styles.shrink}
              stickyHeaderIndices={sticky}
              testID="card-trips-list"
              nestedScrollEnabled
              onScroll={onScroll}
              onContentSizeChange={moreBelow.onContentSizeChange}
              onLayout={moreBelow.onLayout}
              scrollEventThrottle={100}
            >
              {children}
            </ScrollView>
            {/* In scroll mode the card scrolls, and its own fade shows (polish-audit 4). */}
            {outer ? null : <ScrollFade visible={moreBelow.more} color={palette.surfaceRaised} />}
          </View>
        ) : null}
      </Animated.View>

      <Animated.View
        style={[
          hasRows || state.status !== 'idle' ? styles.ctaGap : undefined,
          // 3.3: "New trip" stays at the card's bottom in Trips mode.
          tripsMode && styles.ctaBottom,
          ctaStyle,
        ]}
      >
        {blockedAt === 'new' ? (
          <InlineNotice text={t('offline.readOnly')} colorScheme={colorScheme} />
        ) : null}
        <Button
          kind="cta"
          label={t('card.trips.new')}
          a11yLabel={t('card.trips.newA11y', { country: countryName(country, i18n.language) })}
          icon={(color) => <PlusIcon color={color} size={20} />}
          blocked={readOnly}
          onPress={guard('new', onNewTrip)}
          colorScheme={colorScheme}
          testID="card-new-trip"
          ref={newTripRef}
        />
      </Animated.View>
    </View>
  );
}

/** Sprint 3 AC-6: the trip's status in words, not colour alone (design 3.3). */
export function StatusTag({
  status,
  colorScheme,
}: {
  status: TripStatus;
  colorScheme: ColorScheme;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const [bg, fg] =
    status === 'active'
      ? [palette.successSubtleBg, palette.successSubtleFg]
      : status === 'planned'
        ? [palette.infoBg, palette.infoFg]
        : [palette.tag, palette.textSecondary];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]} importantForAccessibility="no">
      {status === 'active' ? (
        <View style={[styles.dot, { backgroundColor: palette.activeBar }]} />
      ) : null}
      <Text style={[styles.caption, { color: fg }]}>{t(`trips.status.${status}`)}</Text>
    </View>
  );
}

/** Notes up to 6 lines, then "more" (design 2.1). */
function Notes({ text, colorScheme }: { text: string; colorScheme: ColorScheme }) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const [all, setAll] = useState(false);
  const [long, setLong] = useState(false);
  return (
    <View>
      <Text style={[styles.caption, { color: palette.textSecondary }]}>
        {t('card.trips.notes')}
      </Text>
      <Text
        style={[styles.callout, { color: palette.textPrimary }]}
        numberOfLines={all ? undefined : 6}
        onTextLayout={(e) => {
          if (!all && e.nativeEvent.lines.length >= 6) setLong(true);
        }}
      >
        {text}
      </Text>
      {long && !all ? (
        <Button
          kind="text"
          label={t('card.trips.more')}
          onPress={() => setAll(true)}
          colorScheme={colorScheme}
        />
      ) : null}
    </View>
  );
}

/** One placeholder row: two bars (design 2.2). Static: a pulse is a later polish. */
function Skeleton({ colorScheme }: { colorScheme: ColorScheme }) {
  const palette = colors[colorScheme];
  return (
    <View style={styles.skeleton} importantForAccessibility="no-hide-descendants">
      <View style={[styles.bar, { width: '60%', backgroundColor: palette.skeleton }]} />
      <View style={[styles.bar, { width: '40%', backgroundColor: palette.skeleton }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  coupon: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  section: { marginTop: 8 },
  rowWrap: { overflow: 'hidden' },
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  // 4e: in Trips mode the wrapper still lets the list shrink, so "New trip" stays in.
  fadeFill: { flex: 1, flexShrink: 1, minHeight: 0 },
  // Fix my-trips-space 3.2: "Your trips" is a 48dp row.
  heading: {
    minHeight: layout.cardTripsHeadingMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
  },
  headingText: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  pusher: { height: 0 },
  ctaBottom: { marginTop: 'auto', paddingTop: 12 },
  activeBar: { position: 'absolute', top: 8, bottom: 8, start: 0, width: 3, borderRadius: 2 },
  row: {
    minHeight: layout.listRowMin,
    paddingVertical: 8,
    paddingStart: 10,
    paddingEnd: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowText: { flex: 1, gap: 2 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, textAlign: 'left' },
  tabular: { fontVariant: ['tabular-nums'] },
  flipped: { transform: [{ rotate: '180deg' }] },
  details: { paddingHorizontal: 10, paddingBottom: 12, gap: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 4,
    marginTop: 4,
  },
  people: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginTop: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  message: { paddingVertical: 8, gap: 4 },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  more: { height: 48, alignItems: 'center', justifyContent: 'center' },
  ctaGap: { marginTop: 12 },
  skeleton: { paddingVertical: 12, gap: 8 },
  bar: { height: 12, borderRadius: 6 },
});
