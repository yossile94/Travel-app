/**
 * Sprint 5 design 9–12: "Flights" in an open trip row. Each flight is one
 * tappable row (times at each airport, Israel time in brackets, status tags,
 * "updated X ago") that opens the flight sheet (details, change history,
 * booking code). Adding opens FlightScreen; after an outbound flight is
 * added, the return-flight prompt. Offline it reads from the device copy and
 * every write is blocked (sprint 4 pattern).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  I18nManager,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { NextIcon, NoEntryIcon, PencilIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { useDestination } from '@/features/destination/destinationData';
import { isolateLtr, isolateOwn } from '@/features/globe/BoardingPassCard';
import { millisecondsToNextMinute } from '@/features/globe/localTime';
import { useReduceMotion } from '@/features/globe/useReduceMotion';
import { cachedWhen } from '@/features/trips/tripsCache';
import { formatDate } from '@/features/trips/tripDates';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';
import { logFlightSheetShown, logTransition, markTransition } from '@/features/globe/perfLog';

import {
  byDeparture,
  flightChips,
  flightTrackState,
  FLIGHTS_PER_TRIP,
  liveTime,
  shownGate,
  shownTerminal,
  type ChipKind,
  type Direction,
  type Flight,
  type FlightEvent,
  type TrackState,
} from './flightModel';
import { airportTitle, loadAirports, type Airport } from './airportsData';
import { LayoverRow, RouteHeader, SameBookingSheet, waitA11y } from './ConnectionParts';
import { layover, routes } from './connections';
import { deleteFlight } from './flightsApi';
import { FlightScreen, type FlightScreenTrip } from './FlightScreen';
import { refreshTripFlights, useTripFlights } from './flightsStore';
import { dayMonth, dayOffset, sideTimes, spellCode, zonedWall } from './flightTime';
import { defaultDirection } from './flightFormRules';

const CREDIT_URL = 'https://aerodatabox.com';
const PNR_MASK = '••••••';
/** Left-to-right isolate marks, written as escapes (no invisible characters in source). */
const LRI = '⁦';
const PDI = '⁩';
const PNR_AUTO_HIDE_MS = 30_000;
/** The explainer, after the flight's screen closes (sprint 6 design 2.3, timing.push.explainerDelay). */
const EXPLAINER_DELAY_MS = 400;

/** "עודכן לפני 4 דק'" (design 9.5), from the provider's last check. */
export function updatedText(
  checkedAt: string,
  now: Date,
  t: (key: string, o?: Record<string, unknown>) => string,
  a11y = false,
): string {
  const minutes = Math.floor((now.getTime() - Date.parse(checkedAt)) / 60_000);
  if (minutes < 1) return t('flight.updated.now');
  if (minutes === 1) return t('flight.updated.minOne');
  if (minutes < 60)
    return t(a11y ? 'flight.updated.minManyA11y' : 'flight.updated.minMany', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return t('flight.updated.hourOne');
  if (hours === 2) return t('flight.updated.hourTwo');
  if (hours < 24) return t('flight.updated.hourMany', { n: hours });
  const at = new Date(checkedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return t('flight.updated.at', {
    date: isolateLtr(`${at.getDate()}.${at.getMonth() + 1}`),
    time: isolateLtr(`${pad(at.getHours())}:${pad(at.getMinutes())}`),
  });
}

/** One clock for the section, on the minute, while the app is in front (design 9.5). */
function useMinute(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, millisecondsToNextMinute(new Date()));
    };
    timer = setTimeout(tick, millisecondsToNextMinute(new Date()));
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setNow(new Date()));
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [active]);
  return now;
}

function trackLine(
  f: Flight,
  state: TrackState,
  now: Date,
  t: (k: string, o?: Record<string, unknown>) => string,
  a11y = false,
) {
  const checked = f.watch?.checkedAt;
  if (state === 'tracking' || state === 'landed' || state === 'cancelled' || state === 'diverted') {
    return checked ? updatedText(checked, now, t, a11y) : '';
  }
  const text = t(`flight.track.${state}`);
  return state === 'paused' && checked ? `${text} ${updatedText(checked, now, t, a11y)}` : text;
}

function Chip({
  kind,
  colorScheme,
  testID,
}: {
  kind: ChipKind;
  colorScheme: ColorScheme;
  testID: string;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const [bg, fg] =
    kind === 'cancelled' || kind === 'diverted'
      ? [p.entryBannedBg, p.entryBannedFg]
      : kind === 'delayed' || kind === 'earlier' || kind === 'gate-changed'
        ? [p.entryRestrictedBg, p.entryRestrictedFg]
        : kind === 'on-time'
          ? [p.successSubtleBg, p.successSubtleFg]
          : kind === 'departed'
            ? [p.infoBg, p.infoFg]
            : [p.tag, p.textSecondary];
  const icon =
    kind === 'cancelled' ? (
      <NoEntryIcon color={fg} size={12} />
    ) : (
      <Svg width={12} height={12} viewBox="0 0 24 24">
        <Path
          d={ICONS[kind]}
          stroke={fg}
          strokeWidth={2.4}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  return (
    <View
      style={[styles.chip, { backgroundColor: bg }]}
      importantForAccessibility="no"
      testID={testID}
    >
      {kind === 'untracked' ? null : icon}
      <Text style={[styles.caption, { color: fg }]}>{t(`flight.status.${kind}`)}</Text>
    </View>
  );
}

const CLOCK = 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 4v5l3 2';
const ICONS: Record<ChipKind, string> = {
  'on-time': 'M5 12l5 5 9-10',
  delayed: CLOCK,
  earlier: CLOCK,
  'gate-changed': 'M4 8h13l-3-3M20 16H7l3 3',
  cancelled: '',
  diverted: 'M4 12a8 8 0 1014-5.3M18 3v4h-4',
  departed: 'M3 17h18M5 13l14-6',
  landed: 'M3 19h18M5 9l14 6',
  paused: 'M9 6v12M15 6v12',
  untracked: '',
};

function Plane({ color }: { color: string }) {
  return (
    <Svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      // The path points to the start side: it flies start → end, origin → destination (QA S5 #3).
      style={{ transform: [{ scaleX: I18nManager.isRTL ? 1 : -1 }] }}
    >
      <Path d="M2 13l8-1 4-8h2l-2 8 6 1 2-3h2l-1 4 1 4h-2l-2-3-6 1 2 8h-2l-4-8-8-1z" fill={color} />
    </Svg>
  );
}

/** Times of one side, by design 9.3. */
function sideOf(f: Flight, side: 'dep' | 'arr') {
  const snap = f.watch?.snapshot;
  const m = side === 'dep' ? snap?.departure : snap?.arrival;
  const tz = side === 'dep' ? f.depTz : f.arrTz;
  const country = side === 'dep' ? f.depCountry : f.arrCountry;
  const sched = m?.scheduledUtc ?? (side === 'dep' ? f.depSched : f.arrSched);
  return sideTimes(tz, country, sched, f.watch ? liveTime(m) : null);
}

function FlightRow({
  flight,
  now,
  colorScheme,
  onOpen,
  leg = null,
}: {
  flight: Flight;
  now: Date;
  colorScheme: ColorScheme;
  onOpen: () => void;
  /** A leg of a route (sprint 7 design 2.3). */
  leg?: { i: number; n: number } | null;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const state = flightTrackState(flight, now);
  const chips = flightChips(flight, state);
  const dep = sideOf(flight, 'dep');
  const arr = sideOf(flight, 'arr');
  const offset = dep.localDate && arr.localDate ? dayOffset(dep.localDate, arr.localDate) : 0;
  const offsetText = offset === 0 ? '' : offset > 0 ? `+${offset}` : `−${-offset}`;
  const gate = shownGate(flight);
  const gateChanged = chips.includes('gate-changed');
  const terminal = shownTerminal(flight, 'dep');
  const gateLine = [
    terminal ? t('flight.terminalN', { v: terminal }) : null,
    gate ? t('flight.gateN', { v: gate }) : null,
    flight.seat ? t('flight.seatN', { v: flight.seat }) : null,
  ].filter(Boolean);
  const tracking = trackLine(flight, state, now, t);
  const id = flight.id;
  const israel = (s: typeof dep) =>
    s.israel
      ? s.israelDate
        ? t('flight.israelTimeDate', {
            time: isolateLtr(s.israel),
            date: isolateLtr(dayMonth(s.israelDate)),
          })
        : t('flight.israelTime', { time: isolateLtr(s.israel) })
      : null;
  const timeA11y = (s: typeof dep) =>
    s.local
      ? s.changed
        ? `${t('flight.estimatedA11y', { time: s.local })}, ${t('flight.scheduledA11y', { time: s.scheduled })}`
        : s.local
      : t('flight.noDataA11y');
  const label =
    (leg ? `${t('route.legA11y', leg)}, ` : '') +
    t('flight.rowA11y', {
      number: spellCode(flight.number),
      direction: t(`flight.dir.${flight.direction}`),
      status: chips.length ? `, ${chips.map((c) => t(`flight.status.${c}`)).join(', ')}` : '',
      origin: spellCode(flight.depIata),
      dep: `${formatDate(flight.depDateLocal, t)} ${timeA11y(dep)}${dep.israel ? `, ${t('flight.israelA11y', { time: dep.israel })}` : ''}`,
      destination: flight.arrIata ? spellCode(flight.arrIata) : t('flight.noDataA11y'),
      arr: `${timeA11y(arr)}${offset === 1 ? `, ${t('flight.dayAfter')}` : offset === 2 ? `, ${t('flight.twoDaysAfter')}` : offset === -1 ? `, ${t('flight.dayBefore')}` : ''}${arr.israel ? `, ${t('flight.israelA11y', { time: arr.israel })}` : ''}`,
      gateLine: gateLine.length ? `${gateLine.join(', ')}. ` : '',
      tracking: trackLine(flight, state, now, t, true),
    });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('flight.rowHint')}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? p.pressed : p.surface,
          borderColor: colorScheme === 'dark' ? p.borderSubtle : 'transparent',
        },
      ]}
      testID={`card-flight-${id}`}
    >
      <View style={styles.rowTop} importantForAccessibility="no-hide-descendants">
        <Text style={[styles.caption, { color: p.textSecondary }]}>
          {leg
            ? t('route.leg', { i: leg.i, date: isolateLtr(dayMonth(flight.depDateLocal)) })
            : t('flight.rowDate', {
                direction: t(`flight.dir.${flight.direction}`),
                date: isolateLtr(dayMonth(flight.depDateLocal)),
              })}
        </Text>
        <View style={styles.chips}>
          {chips.map((c) => (
            <Chip
              key={c}
              kind={c}
              colorScheme={colorScheme}
              testID={`card-flight-${id}-chip-${c}`}
            />
          ))}
        </View>
      </View>
      <View importantForAccessibility="no-hide-descendants" style={styles.gap4}>
        <Text>
          <Text style={[styles.code, { color: p.textPrimary }]}>{isolateLtr(flight.number)}</Text>
          {flight.airline ? (
            <Text
              style={[styles.callout, { color: p.textSecondary }]}
            >{` · ${flight.airline}`}</Text>
          ) : null}
        </Text>
        <View style={styles.route}>
          <Text style={[styles.title3, { color: p.textPrimary }]}>
            {isolateLtr(flight.depIata)}
          </Text>
          <View style={[styles.dash, { borderColor: p.borderControl }]} />
          <Plane color={p.textTertiary} />
          <View style={[styles.dash, { borderColor: p.borderControl }]} />
          <Text style={[styles.title3, { color: p.textPrimary }]}>
            {isolateLtr(flight.arrIata ?? '—')}
          </Text>
        </View>
        <View style={styles.times}>
          <View style={styles.timeCol}>
            <Text>
              <Text
                style={[
                  styles.numeric,
                  { color: dep.changed ? p.textAlert : dep.local ? p.textPrimary : p.textTertiary },
                ]}
                testID={`card-flight-${id}-dep-time`}
              >
                {isolateLtr(dep.local ?? '—')}
              </Text>
              {dep.scheduled ? (
                <Text
                  style={[styles.footnote, styles.struck, { color: p.textSecondary }]}
                  testID={`card-flight-${id}-dep-scheduled`}
                >
                  {`  ${isolateLtr(dep.scheduled)}`}
                </Text>
              ) : null}
            </Text>
            {israel(dep) ? (
              <Text
                style={[styles.footnote, { color: p.textSecondary }]}
                testID={`card-flight-${id}-dep-israel`}
              >
                {israel(dep)}
              </Text>
            ) : null}
          </View>
          <View style={[styles.timeCol, styles.end]}>
            {/* One left-to-right run: the schedule, the time, then "+1" after it (QA S5 #4). */}
            <Text>
              {LRI}
              {arr.scheduled ? (
                <Text
                  style={[styles.footnote, styles.struck, { color: p.textSecondary }]}
                  testID={`card-flight-${id}-arr-scheduled`}
                >
                  {`${arr.scheduled}  `}
                </Text>
              ) : null}
              <Text
                style={[
                  styles.numeric,
                  { color: arr.changed ? p.textAlert : arr.local ? p.textPrimary : p.textTertiary },
                ]}
                testID={`card-flight-${id}-arr-time`}
              >
                {arr.local ?? '—'}
              </Text>
              {offsetText ? (
                <Text
                  style={[styles.caption, { color: p.textSecondary }]}
                  testID={`card-flight-${id}-day-offset`}
                >
                  {` ${offsetText}`}
                </Text>
              ) : null}
              {PDI}
            </Text>
            {israel(arr) ? (
              <Text
                style={[styles.footnote, { color: p.textSecondary }]}
                testID={`card-flight-${id}-arr-israel`}
              >
                {israel(arr)}
              </Text>
            ) : null}
          </View>
        </View>
        {gateLine.length ? (
          <Text
            style={[styles.footnote, { color: gateChanged ? p.textAlert : p.textSecondary }]}
            testID={`card-flight-${id}-gate-line`}
          >
            {gateLine.map((s) => s).join(' · ')}
          </Text>
        ) : null}
        <View style={styles.trackRow}>
          <Text
            style={[styles.footnote, styles.grow, { color: p.textSecondary }]}
            testID={`card-flight-${id}-tracking`}
          >
            {tracking}
          </Text>
          <NextIcon color={p.textTertiary} size={16} />
        </View>
      </View>
    </Pressable>
  );
}

function Credit({ colorScheme, testID }: { colorScheme: ColorScheme; testID: string }) {
  const p = colors[colorScheme];
  return (
    <Text
      accessibilityRole="link"
      onPress={() => void Linking.openURL(CREDIT_URL)}
      style={[styles.footnote, styles.credit, { color: p.link }]}
      testID={testID}
    >
      {isolateLtr('Flight data by AeroDataBox')}
    </Text>
  );
}

/**
 * A tracked flight's data comes from AeroDataBox (filled by search, or checked
 * since): the credit shows (AC-7א, QA S5 #2).
 */
const hasProviderData = (flights: Flight[]) => flights.some((f) => f.watch !== null);

export function FlightsSection({
  trip,
  colorScheme,
  readOnly,
  onToast,
  openFlight = null,
  alertText = null,
  onAlertFlightShown,
  onTrackedFlightSaved,
}: {
  trip: FlightScreenTrip;
  colorScheme: ColorScheme;
  /** The card shows the device copy: every write blocked (sprint 4 design 10.3). */
  readOnly: boolean;
  onToast: (text: string) => void;
  /** "flightId:seq" from a tapped alert: its sheet opens once the flight is here (AC-5). */
  openFlight?: string | null;
  /** What that alert said, shown over an offline copy (sprint 6 design 4.4). */
  alertText?: { title: string; body: string } | null;
  /** The alert's flight is open: the request is done, never replayed (QA S6 #1). */
  onAlertFlightShown?: () => void;
  /** A tracked flight saved and every screen of it closed (sprint 6 design 2.3). */
  onTrackedFlightSaved?: () => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion() ?? false;
  const data = useTripFlights(trip.id);
  const offline = readOnly || data.fromCache;
  const [screen, setScreen] = useState<{ flight: Flight | null; direction: Direction } | null>(
    null,
  );
  const [sheet, setSheet] = useState<string | null>(null);
  const [returnPrompt, setReturnPrompt] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const now = useMinute(data.flights.length > 0);

  useEffect(() => {
    void refreshTripFlights(trip.id);
    const sub = AppState.addEventListener(
      'change',
      (s) => s === 'active' && void refreshTripFlights(trip.id),
    );
    return () => sub.remove();
  }, [trip.id]);

  const flights = [...data.flights].sort(byDeparture);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  /** The flight whose sheet shows the alert's text; it stays while that sheet is open. */
  const [alertFor, setAlertFor] = useState<string | null>(null);
  const wanted = openFlight?.split(':')[0] ?? null;
  // A flight's screen open in the card: the sheet waits for it to close (Raz re-review 1).
  if (openFlight && openFlight !== openedFor && !screen && flights.some((f) => f.id === wanted)) {
    setOpenedFor(openFlight);
    setSheet(wanted);
    setAlertFor(wanted);
  }
  const open = flights.find((f) => f.id === sheet) ?? null;
  const shown = useRef(onAlertFlightShown);
  useEffect(() => {
    shown.current = onAlertFlightShown;
  }, [onAlertFlightShown]);
  useEffect(() => {
    if (openFlight && openedFor === openFlight) shown.current?.();
  }, [openFlight, openedFor]);

  // Sprint 7: routes and their layovers, worked out each render (design 2.1).
  const items = routes(flights);
  const links = items.flatMap((i) => (i.kind === 'route' ? i.links : []));
  const byId = new Map(flights.map((f) => [f.id, f]));
  const destination = useDestination();
  const [airports, setAirports] = useState<Airport[] | null>(null);
  useEffect(() => {
    // The transit warning needs each airport's country (design 5.1).
    if (links.length === 0 || airports) return;
    loadAirports()
      .then(setAirports)
      .catch(() => {});
  }, [links.length, airports]);
  const [booking, setBooking] = useState<{ prevId: string; nextId: string } | null>(null);
  const layoverRow = (prev: Flight, next: Flight, testID: string, context = false) => (
    <LayoverRow
      key={`${prev.id}>${next.id}`}
      prev={prev}
      next={next}
      now={now}
      tripAdm0={trip.countryAdm0}
      airports={airports}
      advisories={destination.data?.advisories ?? null}
      offline={offline}
      context={context}
      colorScheme={colorScheme}
      onChange={() => setBooking({ prevId: prev.id, nextId: next.id })}
      onBlocked={() => setBlocked(true)}
      testID={testID}
    />
  );
  // Design 11.2: a layover that got worse while shown is announced once.
  const shownStatus = useRef(new Map<string, string>());
  useEffect(() => {
    for (const c of links) {
      const prev = byId.get(c.prevId);
      const next = byId.get(c.nextId);
      if (!prev || !next) continue;
      const l = layover(prev, next, now);
      const before = shownStatus.current.get(c.nextId);
      shownStatus.current.set(c.nextId, l.status);
      if (!before || !['ok', 'short'].includes(before)) continue;
      const apt = spellCode(c.airport);
      if (l.status === 'risky' && l.minutes !== null) {
        AccessibilityInfo.announceForAccessibility(
          t('layover.announce.risky', { apt, time: waitA11y(l.minutes, t) }),
        );
      } else if (l.status === 'missed' || l.status === 'invalid') {
        AccessibilityInfo.announceForAccessibility(t(`layover.announce.${l.status}`, { apt }));
      }
    }
  });
  const openLinks = open ? links.filter((c) => c.prevId === open.id || c.nextId === open.id) : [];

  // Sprint 6 design 2.3: the explainer waits for the return prompt and the
  // return flight's screen, then comes 400 ms after the last one closes.
  const [savedFlight, setSavedFlight] = useState<string | null>(null);
  const saved = flights.find((f) => f.id === savedFlight);
  const offerNow = saved !== undefined && !screen && !returnPrompt && !sheet;
  const offer = useRef(onTrackedFlightSaved);
  useEffect(() => {
    offer.current = onTrackedFlightSaved;
  }, [onTrackedFlightSaved]);
  useEffect(() => {
    if (!offerNow) return;
    const tracked = saved.watch !== null;
    const timer = setTimeout(() => {
      setSavedFlight(null);
      if (tracked) offer.current?.();
    }, EXPLAINER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [offerNow, saved]);

  const guard = (action: () => void) => () => (offline ? setBlocked(true) : action());

  return (
    <View style={styles.section} testID="card-flights">
      <Text
        style={[styles.caption, { color: p.textSecondary }]}
        accessibilityRole="header"
        accessibilityActions={[{ name: 'refresh', label: t('flights.refresh') }]}
        onAccessibilityAction={() => void refreshTripFlights(trip.id)}
        testID="card-flights-title"
      >
        {t('flights.title')}
      </Text>
      {data.status === 'loading' && flights.length === 0 ? (
        <View
          style={[styles.skeleton, { backgroundColor: p.skeleton }]}
          testID="card-flights-skeleton"
        />
      ) : null}
      {items.map((item) =>
        item.kind === 'flight' ? (
          <FlightRow
            key={item.flight.id}
            flight={item.flight}
            now={now}
            colorScheme={colorScheme}
            onOpen={() => {
              markTransition('flight');
              setSheet(item.flight.id);
            }}
          />
        ) : (
          <View key={item.legs[0]!.id} testID={`card-route-${item.legs[0]!.id}`}>
            <RouteHeader
              legs={item.legs}
              direction={item.legs[0]!.direction}
              colorScheme={colorScheme}
              testID={`card-route-${item.legs[0]!.id}-header`}
            />
            {item.legs.map((f, i) => (
              <View key={f.id}>
                {i > 0 ? layoverRow(item.legs[i - 1]!, f, `card-layover-${f.id}`) : null}
                <FlightRow
                  flight={f}
                  now={now}
                  colorScheme={colorScheme}
                  onOpen={() => {
                    markTransition('flight');
                    setSheet(f.id);
                  }}
                  leg={{ i: i + 1, n: item.legs.length }}
                />
              </View>
            ))}
          </View>
        ),
      )}
      {data.status === 'error' ? (
        <View style={styles.errorRow}>
          <Text
            style={[styles.footnote, styles.grow, { color: p.textSecondary }]}
            testID="card-flights-status-error"
          >
            {t('flights.statusError')}
          </Text>
          <Button
            kind="text"
            label={t('flights.retry')}
            onPress={() => void refreshTripFlights(trip.id)}
            colorScheme={colorScheme}
            testID="card-flights-retry"
          />
        </View>
      ) : null}
      {blocked ? (
        <InlineNotice
          text={t('flights.readOnly')}
          colorScheme={colorScheme}
          testID="card-flight-readonly"
        />
      ) : null}
      {flights.length >= FLIGHTS_PER_TRIP ? (
        <Text style={[styles.footnote, { color: p.textSecondary }]} testID="card-flight-add-limit">
          {t('flight.limit')}
        </Text>
      ) : data.status !== 'loading' || flights.length > 0 ? (
        <Button
          kind="link"
          label={t('flights.add')}
          icon={(color) => <PlusIcon color={color} size={20} />}
          blocked={offline}
          onPress={guard(() => setScreen({ flight: null, direction: defaultDirection(flights) }))}
          colorScheme={colorScheme}
          testID="card-flight-add"
        />
      ) : null}
      {flights.length === 0 && data.status === 'ready' ? (
        <Text
          style={[styles.footnote, { color: p.textSecondary }]}
          testID="card-flights-empty-help"
        >
          {t('flights.emptyHelp')}
        </Text>
      ) : null}
      {hasProviderData(flights) ? (
        <Credit colorScheme={colorScheme} testID="card-flights-credit" />
      ) : null}

      {screen ? (
        <FlightScreen
          trip={trip}
          flight={screen.flight}
          direction={screen.direction}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onClose={() => setScreen(null)}
          onSaved={(id, _number, direction, isNew, bookingFailed) => {
            setScreen(null);
            setSavedFlight(id);
            // Sprint 7 design 6.3: the flight is saved; only the booking answer needs another try.
            if (bookingFailed) onToast(t('flight.sameBookingFailed'));
            void refreshTripFlights(trip.id);
            // Design 8.4: after adding an outbound flight, when there is no return yet.
            if (isNew && direction === 'out' && !flights.some((f) => f.direction === 'return')) {
              setReturnPrompt(true);
            }
          }}
          onDeleted={() => {
            setScreen(null);
            void refreshTripFlights(trip.id);
            onToast(t('flight.deleted'));
          }}
        />
      ) : null}
      <FlightSheet
        flight={open}
        trip={trip}
        now={now}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insets.bottom}
        offline={offline}
        cachedAt={data.fromCache ? data.savedAt : null}
        alertText={open && open.id === alertFor ? alertText : null}
        onClose={() => {
          setSheet(null);
          setAlertFor(null);
        }}
        onEdit={(f) => {
          setSheet(null);
          setScreen({ flight: f, direction: f.direction });
        }}
        onDeleted={() => {
          setSheet(null);
          void refreshTripFlights(trip.id);
          onToast(t('flight.deleted'));
        }}
        onRefresh={() => void refreshTripFlights(trip.id)}
        connection={
          openLinks.length > 0 ? (
            <View style={styles.gap8}>
              <Text style={[styles.caption, { color: p.textSecondary }]} accessibilityRole="header">
                {t('layover.sheetTitle')}
              </Text>
              {openLinks.map((c) =>
                layoverRow(
                  byId.get(c.prevId)!,
                  byId.get(c.nextId)!,
                  `flight-sheet-layover-${c.nextId}`,
                  true,
                ),
              )}
            </View>
          ) : null
        }
      />
      <SameBookingSheet
        prev={booking ? (byId.get(booking.prevId) ?? null) : null}
        next={booking ? (byId.get(booking.nextId) ?? null) : null}
        visible={booking !== null && byId.has(booking.prevId) && byId.has(booking.nextId)}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insets.bottom}
        onClose={() => setBooking(null)}
        onSaved={() => {
          setBooking(null);
          void refreshTripFlights(trip.id);
        }}
        onGone={() => {
          setBooking(null);
          onToast(t('flight.gone'));
          void refreshTripFlights(trip.id);
        }}
      />
      <BottomSheet
        visible={returnPrompt}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insets.bottom}
        onClose={() => setReturnPrompt(false)}
        testID="return-prompt"
      >
        <View style={styles.sheetBody}>
          <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
            {t('returnPrompt.title')}
          </Text>
          <Text style={[styles.body, { color: p.textSecondary }]}>
            {t('returnPrompt.body', { date: isolateLtr(formatDate(trip.endDate, t)) })}
          </Text>
          <Button
            kind="primary"
            label={t('returnPrompt.add')}
            onPress={() => {
              setReturnPrompt(false);
              setScreen({ flight: null, direction: 'return' });
            }}
            colorScheme={colorScheme}
            testID="return-prompt-add"
          />
          <Button
            kind="text"
            label={t('returnPrompt.later')}
            onPress={() => setReturnPrompt(false)}
            colorScheme={colorScheme}
            testID="return-prompt-later"
          />
        </View>
      </BottomSheet>
    </View>
  );
}

function eventText(
  e: FlightEvent,
  f: Flight,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (e.field === 'status')
    return t(e.new === 'Canceled' ? 'flight.ev.cancelled' : 'flight.ev.diverted');
  if (e.field === 'dep_gate' || e.field === 'arr_gate') {
    return t('flight.ev.gate', { from: isolateLtr(e.old ?? '—'), to: isolateLtr(e.new ?? '—') });
  }
  const tz = e.field === 'dep_time' ? f.depTz : (f.arrTz ?? f.depTz);
  const from = e.old ? zonedWall(tz, new Date(e.old)) : null;
  const to = e.new ? zonedWall(tz, new Date(e.new)) : null;
  const later = e.old && e.new ? Date.parse(e.new) > Date.parse(e.old) : true;
  const days = from && to ? dayOffset(from.date, to.date) : 0;
  const toText = `${to?.time ?? '—'}${days > 0 ? ` (+${days})` : days < 0 ? ` (−${-days})` : ''}`;
  const key =
    e.field === 'dep_time'
      ? later
        ? 'depLater'
        : 'depEarlier'
      : later
        ? 'arrLater'
        : 'arrEarlier';
  return t(`flight.ev.${key}`, { from: isolateLtr(from?.time ?? '—'), to: isolateLtr(toText) });
}

function FlightSheet({
  flight,
  trip,
  now,
  colorScheme,
  reduceMotion,
  insetsBottom,
  offline,
  cachedAt,
  alertText,
  onClose,
  onEdit,
  onDeleted,
  onRefresh,
  connection = null,
}: {
  flight: Flight | null;
  trip: FlightScreenTrip;
  now: Date;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  offline: boolean;
  cachedAt: string | null;
  alertText: { title: string; body: string } | null;
  onClose: () => void;
  onEdit: (f: Flight) => void;
  onDeleted: () => void;
  onRefresh: () => void;
  /** Sprint 7 design 7: the layovers of this leg, under the tracking line. */
  connection?: ReactNode;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const [shown, setShown] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const { i18n } = useTranslation();
  // Airport names for the sheet's sides (design 10.1, QA S5 #5): the bundled list, loaded on open.
  const [airports, setAirports] = useState<Airport[] | null>(null);
  useEffect(() => {
    if (!flight || airports) return;
    loadAirports()
      .then(setAirports)
      .catch(() => {});
  }, [flight, airports]);
  const airportName = (iata: string | null) => {
    const a = iata ? airports?.find((x) => x.iata === iata) : undefined;
    // Each part isolated: an English name never swaps places with the code (QA S5 R-2).
    const parts = a ? [...airportTitle(a, i18n.language).split(' · '), iata!] : [iata ?? '—'];
    return parts.map(isolateOwn).join(' · ');
  };

  // The booking code hides again after 30 s, on close and in the background (design 7.2).
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(false), PNR_AUTO_HIDE_MS);
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && setShown(false));
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [shown]);
  const close = () => {
    setShown(false);
    setBlocked(false);
    onClose();
  };

  const f = flight;
  const state = f ? flightTrackState(f, now) : 'not_checked';
  const chips = f ? flightChips(f, state) : [];
  const dep = f ? sideOf(f, 'dep') : null;
  const arr = f ? sideOf(f, 'arr') : null;
  const events = f?.watch?.events ?? [];
  const guard = (action: () => void) => () => (offline ? setBlocked(true) : action());

  const remove = () => {
    if (!f) return;
    Alert.alert(t('flight.deleteTitle', { number: f.number }), t('flight.deleteBody'), [
      { text: t('flight.cancel'), style: 'cancel' },
      {
        text: t('flight.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true);
            const result = await deleteFlight(f.id);
            setBusy(false);
            if (result === 'ok' || result === 'gone') onDeleted();
            else if (result === 'offline') setBlocked(true);
          })();
        },
      },
    ]);
  };

  const sideBlock = (side: 'dep' | 'arr') => {
    if (!f) return null;
    const s = side === 'dep' ? dep! : arr!;
    const iata = side === 'dep' ? f.depIata : f.arrIata;
    const terminal = shownTerminal(f, side);
    const gate = side === 'dep' ? shownGate(f) : null;
    const date = s.localDate ?? (side === 'dep' ? f.depDateLocal : null);
    const line2 = [
      terminal ? t('flight.terminalN', { v: terminal }) : null,
      gate ? t('flight.gateN', { v: gate }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <View style={styles.gap4} accessible testID={`flight-sheet-${side}`}>
        <Text style={[styles.caption, { color: p.textSecondary }]} accessibilityRole="header">
          {t(side === 'dep' ? 'flight.departure' : 'flight.arrival')}
        </Text>
        <Text style={[styles.body, { color: p.textPrimary }]}>{airportName(iata)}</Text>
        <Text style={[styles.numeric, { color: s.changed ? p.textAlert : p.textPrimary }]}>
          {isolateLtr(`${date ? `${dayMonth(date)}.${date.slice(0, 4)} · ` : ''}${s.local ?? '—'}`)}
          {s.scheduled ? (
            <Text
              style={[styles.footnote, styles.struck, { color: p.textSecondary }]}
            >{`  ${isolateLtr(s.scheduled)}`}</Text>
          ) : null}
          {s.israel ? (
            <Text style={[styles.footnote, { color: p.textSecondary }]}>
              {` ${s.israelDate ? t('flight.israelTimeDate', { time: isolateLtr(s.israel), date: isolateLtr(dayMonth(s.israelDate)) }) : t('flight.israelTime', { time: isolateLtr(s.israel) })}`}
            </Text>
          ) : null}
        </Text>
        {line2 ? <Text style={[styles.footnote, { color: p.textSecondary }]}>{line2}</Text> : null}
      </View>
    );
  };

  return (
    <BottomSheet
      visible={f !== null}
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={close}
      maxHeight={640}
      testID="flight-sheet"
    >
      {f ? (
        <ScrollView
          contentContainerStyle={styles.sheetBody}
          onLayout={() => {
            logTransition('flight');
            logFlightSheetShown();
          }}
        >
          <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
            {`${isolateLtr(f.number)} · ${t(`flight.dir.${f.direction}`)}`}
          </Text>
          {f.airline ? (
            <Text style={[styles.callout, { color: p.textSecondary }]}>{f.airline}</Text>
          ) : null}
          {cachedAt ? (
            <InlineNotice
              text={t('offline.cachedAt', { when: cachedWhen(cachedAt, t) })}
              colorScheme={colorScheme}
              testID="flight-sheet-cached"
            />
          ) : null}
          {cachedAt && alertText ? (
            <InlineNotice
              text={t('push.fromNotification', alertText)}
              colorScheme={colorScheme}
              testID="flight-sheet-from-notification"
            />
          ) : null}
          <View style={styles.chips}>
            {chips.map((c) => (
              <Chip key={c} kind={c} colorScheme={colorScheme} testID={`flight-sheet-chip-${c}`} />
            ))}
          </View>
          <Text
            style={[styles.footnote, { color: p.textSecondary }]}
            testID="flight-sheet-tracking"
          >
            {trackLine(f, state, now, t)}
          </Text>
          {connection}
          {sideBlock('dep')}
          {sideBlock('arr')}
          {events.length > 0 ? (
            <View style={styles.gap8} testID="flight-sheet-history">
              <Text style={[styles.title3, { color: p.textPrimary }]} accessibilityRole="header">
                {t('flight.history')}
              </Text>
              {events.map((e) => (
                <View key={e.id} accessible style={styles.event} testID={`flight-event-${e.id}`}>
                  {e.field === 'status' ? <NoEntryIcon color={p.textAlert} size={16} /> : null}
                  <View style={styles.grow}>
                    <Text style={[styles.body, { color: p.textPrimary }]}>
                      {eventText(e, f, t)}
                    </Text>
                    <Text style={[styles.footnote, { color: p.textSecondary }]}>
                      {t('flight.ev.detected', { when: cachedWhen(e.at, t, now) })}
                    </Text>
                  </View>
                </View>
              ))}
              {events.length >= 50 ? (
                <Text style={[styles.footnote, { color: p.textSecondary }]}>
                  {t('flight.ev.capped')}
                </Text>
              ) : null}
            </View>
          ) : null}
          {f.pnr || f.seat || f.cabin ? (
            <View style={styles.gap8}>
              <Text style={[styles.title3, { color: p.textPrimary }]} accessibilityRole="header">
                {t('flight.booking')}
              </Text>
              {f.pnr ? (
                <View style={styles.pnrRow}>
                  <View style={styles.grow}>
                    <Text style={[styles.caption, { color: p.textSecondary }]}>
                      {t('flight.pnrLabel')}
                    </Text>
                    <Text
                      style={[styles.code, { color: p.textPrimary }]}
                      accessibilityLabel={
                        shown
                          ? `${t('flight.pnrLabel')}: ${spellCode(f.pnr).split('').join(' ')}`
                          : t('flight.pnrHidden')
                      }
                      testID="flight-sheet-pnr"
                    >
                      {shown ? isolateLtr(f.pnr) : PNR_MASK}
                    </Text>
                  </View>
                  <Button
                    kind="text"
                    label={t(shown ? 'flight.hide' : 'flight.show')}
                    a11yLabel={t(shown ? 'flight.pnrHide' : 'flight.pnrShow')}
                    onPress={() => setShown((v) => !v)}
                    colorScheme={colorScheme}
                    testID="flight-sheet-pnr-toggle"
                  />
                </View>
              ) : null}
              {f.seat || f.cabin ? (
                <Text
                  style={[styles.body, { color: p.textPrimary }]}
                  testID="flight-sheet-seat-class"
                >
                  {[
                    f.seat ? t('flight.seatN', { v: isolateLtr(f.seat) }) : null,
                    f.cabin ? t('flight.classN', { class: t(`flight.cabin.${f.cabin}`) }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
          ) : null}
          {f.watch ? <Credit colorScheme={colorScheme} testID="flight-sheet-credit" /> : null}
          {blocked ? (
            <InlineNotice
              text={t('flights.readOnly')}
              colorScheme={colorScheme}
              testID="flight-sheet-readonly"
            />
          ) : null}
          <View style={styles.actions}>
            <Button
              kind="secondary"
              outlined={colorScheme === 'dark'}
              label={t('flight.edit')}
              icon={(color) => <PencilIcon color={color} size={20} />}
              blocked={offline}
              disabled={busy}
              onPress={guard(() => onEdit(f))}
              colorScheme={colorScheme}
              testID="flight-sheet-edit"
            />
            <Button
              kind="text"
              label={t('flight.deleteShort')}
              icon={(color) => <TrashIcon color={color} size={20} />}
              blocked={offline}
              busy={busy}
              onPress={guard(remove)}
              colorScheme={colorScheme}
              testID="flight-sheet-delete"
            />
            <Button
              kind="text"
              label={t('flights.refresh')}
              onPress={onRefresh}
              colorScheme={colorScheme}
              testID="flight-sheet-refresh"
            />
          </View>
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  row: { borderRadius: radius.md, borderWidth: 1, padding: 12, gap: 6 },
  rowTop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  gap4: { gap: 4 },
  gap8: { gap: 8 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dash: { flex: 1, borderTopWidth: 1, borderStyle: 'dashed' },
  times: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  timeCol: { flexShrink: 1 },
  end: { alignItems: 'flex-end' },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skeleton: { height: 120, borderRadius: radius.md },
  credit: {
    minHeight: layout.touchTargetMin,
    textAlignVertical: 'center',
    textDecorationLine: 'underline',
    alignSelf: 'flex-start',
  },
  sheetBody: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  event: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  pnrRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  title2: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, textAlign: 'left' },
  title3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, letterSpacing: 1.6 },
  code: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, letterSpacing: 1.6 },
  numeric: {
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  struck: { textDecorationLine: 'line-through' },
});
