/**
 * Sprint 5 F-016 (AC-1 to AC-5), design 2–8: one screen to add or edit a
 * flight, from the card or the trip form. Step 1 searches by number and date;
 * several legs → choose one; step 2 is the same form filled by the provider
 * or typed by hand. Every provider failure lands on that form, never a dead
 * end. Saved through save_flight with the id made when the screen opened.
 */
import * as Crypto from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Button, DateField, TextField } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { BackIcon, ClockIcon, NextIcon, TrashIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { isolateLtr, isolateOwn } from '@/features/globe/BoardingPassCard';
import { formatDate, fromPgDate, toPgDate, todayPg, addDays } from '@/features/trips/tripDates';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { airportTitle, loadAirports, type Airport } from './airportsData';
import { AirportPicker } from './AirportPicker';
import {
  changed,
  checkDetails,
  checkSearch,
  defaultDate,
  emptyValues,
  pickedFrom,
  toSaved,
  valuesOf,
  warnings as warningsOf,
  withLeg,
  type Errors,
  type FlightFormValues,
  type PickedAirport,
  continuedDirection,
  draftLeg,
} from './flightFormRules';
import {
  DAYS_AHEAD,
  normalizeFlightNumber,
  typingCode,
  typingFlightNumber,
  type Cabin,
  type Direction,
  type Flight,
  type FlightSnapshot,
} from './flightModel';
import { deleteFlight, lookupFlight, saveFlight, setSameBooking } from './flightsApi';
import { useDestination } from '@/features/destination/destinationData';
import { TransitNotice, transitWarning, waitText } from './ConnectionParts';
import { connections, layover, sameBooking as answerOf } from './connections';
import { useTripFlights } from './flightsStore';
import { dayMonth, spellCode, zonedWall } from './flightTime';

export interface FlightScreenTrip {
  id: string;
  title: string;
  countryAdm0: string;
  startDate: string;
  endDate: string;
}

type Step = 'search' | 'legs' | 'details';
type SearchNotice = 'found' | 'notFound' | 'unavailable' | 'rateLimited' | null;
type SaveNotice = 'offline' | 'error' | 'gone' | 'limit' | 'trackLimit' | 'consent' | null;

const DIRECTIONS: Direction[] = ['out', 'return', 'internal'];
const CABINS: Cabin[] = ['economy', 'premium_economy', 'business', 'first'];

export function FlightScreen({
  trip,
  flight,
  direction: startDirection,
  colorScheme,
  reduceMotion,
  insetsTop,
  insetsBottom,
  onClose,
  onSaved,
  onDeleted,
}: {
  trip: FlightScreenTrip;
  /** Editing: opens on step 2 with the saved values. */
  flight: Flight | null;
  /** Adding: the direction to start with (design 2.1, 8.4). */
  direction: Direction;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  /** bookingFailed: saved, but the "same booking" answer didn't go (sprint 7 design 6.3). */
  onSaved: (
    flightId: string,
    number: string,
    direction: Direction,
    isNew: boolean,
    bookingFailed?: boolean,
  ) => void;
  onDeleted: (flightId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { recheckConsent } = useAuth();
  const palette = colors[colorScheme];
  const editing = flight !== null;
  const [id] = useState(() => flight?.id ?? Crypto.randomUUID());
  const initial = useMemo(
    () =>
      flight ? valuesOf(flight) : emptyValues(startDirection, defaultDate(startDirection, trip)),
    // Opened once; the values live in state from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [values, setValues] = useState<FlightFormValues>(initial);
  const [step, setStep] = useState<Step>(editing ? 'details' : 'search');
  const [searched, setSearched] = useState(false);
  const [legs, setLegs] = useState<FlightSnapshot[]>([]);
  const [searchNotice, setSearchNotice] = useState<SearchNotice>(null);
  const [offlineSearch, setOfflineSearch] = useState(false);
  const [saveNotice, setSaveNotice] = useState<SaveNotice>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState<'search' | 'save' | 'delete' | null>(null);
  const [picking, setPicking] = useState<'origin' | 'destination' | null>(null);
  const [pnrShown, setPnrShown] = useState(false);
  const [airports, setAirports] = useState<Airport[] | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  // Sprint 7: the trip's other flights, for the connection this one makes (design 6).
  const tripFlights = useTripFlights(trip.id).flights;
  const destination = useDestination();
  const [dirTouched, setDirTouched] = useState(false);
  /** The "same booking?" answers by the other leg's id; absent: not touched (design 6.3). */
  const [answers, setAnswers] = useState<Record<string, boolean | null>>({});
  const now = new Date();
  const today = todayPg();

  // Airport titles for codes the provider or a saved flight gave (design 4.1).
  useEffect(() => {
    if (step !== 'details' || airports) return;
    loadAirports()
      .then(setAirports)
      .catch(() => {});
  }, [step, airports]);
  const byCode = (iata: string | null): PickedAirport | null => {
    const a = iata ? airports?.find((x) => x.iata === iata) : undefined;
    return a ? pickedFrom(a, airportTitle(a, i18n.language)) : null;
  };
  const titleOf = (p: PickedAirport | null) => {
    if (!p) return null;
    if (p.title) return `${p.title}`;
    const a = byCode(p.iata);
    return a?.title ?? p.iata;
  };

  const locked = busy !== null;
  const set = (patch: Partial<FlightFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const errorText = (key: keyof Errors) => (errors[key] ? t(`flight.err.${errors[key]}`) : null);
  const recheck = (next: FlightFormValues) => {
    if (Object.keys(errors).length === 0) return;
    setErrors(step === 'details' ? checkDetails(next, today) : checkSearch(next, today));
  };
  const update = (patch: Partial<FlightFormValues>) => {
    const next = { ...values, ...patch };
    setValues(next);
    recheck(next);
  };

  const pickDate = (field: 'date' | 'depDate' | 'arrDate') => {
    const current = values[field] ?? values.date ?? trip.startDate;
    DateTimePickerAndroid.open({
      mode: 'date',
      value: fromPgDate(current),
      maximumDate: fromPgDate(addDays(today, DAYS_AHEAD)),
      positiveButton: { label: t('datePicker.ok') },
      negativeButton: { label: t('datePicker.cancel') },
      onValueChange: (_event, date) => {
        const picked = toPgDate(date);
        if (field === 'date') {
          // The departure date of step 1 is also the departure date of step 2.
          update({
            date: picked,
            depDate: picked,
            arrDate: values.arrTime ? values.arrDate : picked,
          });
        } else if (field === 'depDate') update({ depDate: picked, date: picked });
        else update({ arrDate: picked });
      },
    });
  };
  const pickTime = (field: 'depTime' | 'arrTime') => {
    const [h, m] = (values[field] ?? '12:00').split(':').map(Number);
    const value = new Date();
    value.setHours(h!, m!, 0, 0);
    DateTimePickerAndroid.open({
      mode: 'time',
      is24Hour: true,
      value,
      positiveButton: { label: t('datePicker.ok') },
      negativeButton: { label: t('datePicker.cancel') },
      onValueChange: (_event, date) =>
        update({
          [field]: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
        }),
    });
  };

  const search = async () => {
    const found = checkSearch(values, today);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const number = normalizeFlightNumber(values.numberInput)!;
    setValues((v) => ({ ...v, numberInput: number }));
    setBusy('search');
    const result = await lookupFlight(number, values.date!);
    setBusy(null);
    if (result.kind === 'offline') {
      setOfflineSearch(true);
      return;
    }
    setOfflineSearch(false);
    setSearched(true);
    const list = await loadAirports().catch(() => null);
    if (list) setAirports(list);
    const code = (iata: string | null) => {
      const a = iata ? list?.find((x) => x.iata === iata) : undefined;
      return a ? pickedFrom(a, airportTitle(a, i18n.language)) : null;
    };
    if (result.kind === 'found') {
      const ordered = [...result.legs].sort((a, b) =>
        (a.departure.scheduledUtc ?? '').localeCompare(b.departure.scheduledUtc ?? ''),
      );
      if (ordered.length > 1) {
        setLegs(ordered);
        setStep('legs');
        return;
      }
      setValues((v) => withLeg({ ...v, numberInput: number }, ordered[0]!, code));
      setSearchNotice('found');
    } else {
      if (result.kind === 'notFound') console.error('[flights] flight_lookup_not_found');
      if (result.kind === 'rateLimited') console.error('[flights] flight_lookup_rate_limited');
      setSearchNotice(result.kind);
    }
    setStep('details');
  };

  const chooseLeg = (leg: FlightSnapshot) => {
    setValues((v) => withLeg(v, leg, byCode));
    setSearchNotice('found');
    setStep('details');
  };

  const manual = () => {
    const found = checkSearch(values, today);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setValues((v) => ({ ...v, numberInput: normalizeFlightNumber(v.numberInput)! }));
    setSearchNotice(null);
    setStep('details');
  };

  // Design 6.1: a continuing leg takes the direction of the one it continues,
  // when adding, until the user picks one.
  const draft = draftLeg(values, id, trip.id);
  const others = tripFlights.filter((f) => f.id !== id);
  const auto =
    !editing && !dirTouched && step === 'details' ? continuedDirection(draft, others) : null;
  const [autoFor, setAutoFor] = useState<string | null>(null);
  const autoKey = auto ? `${auto.prev.id}:${auto.direction}` : null;
  if (auto && autoKey !== autoFor) {
    setAutoFor(autoKey);
    if (values.direction !== auto.direction)
      setValues((v) => ({ ...v, direction: auto.direction }));
  }
  const autoRef = useRef(auto);
  useEffect(() => {
    autoRef.current = auto;
  });
  useEffect(() => {
    const a = autoRef.current;
    if (!autoFor || !a) return;
    AccessibilityInfo.announceForAccessibility(
      t('flight.directionAutoA11y', {
        direction: t(`flight.dir.${a.direction}`),
        prev: spellCode(a.prev.numberInput || a.prev.number),
      }),
    );
  }, [autoFor, t]);
  // Design 6.2: the connections this flight makes, with its values as typed.
  const asFlight = draft
    ? ({
        ...(flight ?? {}),
        ...draft,
        numberInput: values.numberInput,
        number: values.numberInput,
        watch: null,
      } as Flight)
    : null;
  const formLinks = asFlight
    ? connections([...others, asFlight]).filter((c) => c.prevId === id || c.nextId === id)
    : [];
  const byIdForm = new Map([...others, ...(asFlight ? [asFlight] : [])].map((f) => [f.id, f]));

  /** After the flight saved: the answers the user gave, on each later leg (design 6.3). */
  const saveBooking = async () => {
    let failed = false;
    for (const c of formLinks) {
      const other = c.prevId === id ? c.nextId : c.prevId;
      if (!(other in answers)) continue;
      const result = await setSameBooking(c.nextId, c.prevId, answers[other]!);
      if (result !== 'ok') failed = true;
    }
    return failed;
  };

  const save = async () => {
    const found = checkDetails(values, today);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      scroll.current?.scrollTo({ y: 0, animated: !reduceMotion });
      return;
    }
    setBusy('save');
    setSaveNotice(null);
    const saved = toSaved(values);
    const result = await saveFlight(id, trip.id, saved);
    setBusy(null);
    if (result === 'ok') {
      AccessibilityInfo.announceForAccessibility(
        t('flight.saved', { number: spellCode(saved.number) }),
      );
      const bookingFailed = await saveBooking();
      onSaved(id, saved.number, saved.direction, !editing, bookingFailed);
    } else if (result === 'consent') {
      // The consent screen opens over this one, which keeps everything (as trips).
      setSaveNotice('consent');
      if (!(await recheckConsent())) setSaveNotice('error');
    } else
      setSaveNotice(
        result === 'offline'
          ? 'offline'
          : result === 'gone'
            ? 'gone'
            : result === 'limit'
              ? 'limit'
              : result === 'trackLimit'
                ? 'trackLimit'
                : 'error',
      );
  };

  const remove = () => {
    Alert.alert(t('flight.deleteTitle', { number: flight!.number }), t('flight.deleteBody'), [
      { text: t('flight.cancel'), style: 'cancel' },
      {
        text: t('flight.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy('delete');
            const result = await deleteFlight(flight!.id);
            setBusy(null);
            if (result === 'ok' || result === 'gone') onDeleted(flight!.id);
            else setSaveNotice(result === 'offline' ? 'offline' : 'error');
          })();
        },
      },
    ]);
  };

  const requestClose = () => {
    if (locked) return;
    if (picking) return setPicking(null);
    if (step === 'legs') return setStep('search');
    // A search costs a unit: leaving after one asks too (design 8.2).
    if (!changed(values, initial) && !searched) return onClose();
    Alert.alert(t('flight.discardTitle'), t('flight.discardBody'), [
      { text: t('flight.keep'), style: 'cancel' },
      { text: t('flight.discard'), style: 'destructive', onPress: onClose },
    ]);
  };

  const warnings = step === 'details' ? warningsOf(values, trip, now) : [];
  const warning = (kind: string, side?: 'dep' | 'arr') =>
    warnings.find(
      (w) => w.kind === kind && (side === undefined || (w.kind === 'dst' && w.side === side)),
    );
  const dstText = (side: 'dep' | 'arr') => {
    const w = warning('dst', side);
    if (!w || w.kind !== 'dst') return null;
    const airport = side === 'dep' ? values.origin : values.destination;
    const date = side === 'dep' ? values.depDate! : values.arrDate!;
    const time = side === 'dep' ? values.depTime! : values.arrTime!;
    const place = titleOf(airport)?.split(' · ')[0] ?? airport?.iata ?? '';
    return w.result.kind === 'gap'
      ? t('flight.warn.dstGap', { date: dayMonth(date), place, time, saved: w.result.savedWall })
      : t('flight.warn.dstOverlap', { date: dayMonth(date), place, time });
  };
  const outsideRange = `${dayMonth(trip.startDate)}–${dayMonth(trip.endDate)}`;

  const searchNoticeText =
    searchNotice === 'found'
      ? t('flight.found')
      : searchNotice === 'notFound'
        ? t('flight.notFound', { number: values.numberInput, date: dayMonth(values.date ?? today) })
        : searchNotice === 'unavailable'
          ? t('flight.unavailable')
          : searchNotice === 'rateLimited'
            ? t('flight.rateLimited')
            : null;
  const saveNoticeText =
    saveNotice === 'offline'
      ? t('flight.saveOffline')
      : saveNotice === 'gone'
        ? t('flight.tripGone')
        : saveNotice === 'limit'
          ? t('flight.limit')
          : saveNotice === 'trackLimit'
            ? t('flight.trackLimit')
            : saveNotice === 'consent'
              ? t('tripForm.consentNeeded')
              : saveNotice === 'error'
                ? t('flight.saveError')
                : null;

  const timeHelp = (p: PickedAirport | null) =>
    p
      ? t('flight.timeZoneHelp', { city: titleOf(p)?.split(' · ')[0] ?? p.iata, code: p.iata })
      : t('flight.timeNeedsAirport');
  const empty = searchNotice === 'found' ? t('flight.noData') : t('flight.optional');

  const chip = (label: string, selected: boolean, onPress: () => void, testID: string) => (
    <Pressable
      key={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: locked }}
      disabled={locked}
      onPress={onPress}
      hitSlop={4}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? palette.primary : palette.surface,
          borderColor: selected ? palette.primary : palette.borderControl,
        },
      ]}
      testID={testID}
    >
      <Text
        style={[styles.chipText, { color: selected ? palette.onPrimary : palette.textPrimary }]}
      >
        {selected ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
  const directionChips = (
    <View>
      <Text
        style={[styles.caption, { color: palette.textSecondary }]}
        importantForAccessibility="no"
      >
        {t('flight.direction')}
      </Text>
      <View
        style={styles.chips}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('flight.direction')}
      >
        {DIRECTIONS.map((d) =>
          chip(
            t(`flight.dir.${d}`),
            values.direction === d,
            () => {
              // Until the user picks a date, the direction sets it (design 2.1).
              const date =
                values.date === defaultDate(values.direction, trip)
                  ? defaultDate(d, trip)
                  : values.date;
              setDirTouched(true);
              update({ direction: d, date, depDate: step === 'search' ? date : values.depDate });
            },
            `flight-dir-${d === 'out' ? 'outbound' : d}`,
          ),
        )}
      </View>
      {auto && values.direction === auto.direction ? (
        <Text
          style={[styles.footnote, { color: palette.textSecondary }]}
          accessibilityLiveRegion="polite"
          testID="flight-direction-auto"
        >
          {t('flight.directionAuto', {
            prev: isolateLtr(auto.prev.numberInput || auto.prev.number),
          })}
        </Text>
      ) : null}
    </View>
  );

  // Design 6.2: one block per connection this flight makes.
  const connectionBlock = (c: (typeof formLinks)[number], i: number) => {
    const prev = byIdForm.get(c.prevId)!;
    const next = byIdForm.get(c.nextId)!;
    const other = c.prevId === id ? next : prev;
    const otherNo = other.numberInput || other.number;
    const l = layover(prev, next, now);
    const route = [prev.depIata, c.airport, next.arrIata ?? '—'].map(isolateLtr).join(' ‹ ');
    const touched = other.id in answers;
    const answer = touched ? answers[other.id]! : editing ? answerOf(next, prev.id) : undefined;
    const transit = transitWarning(
      c.airport,
      airports,
      destination.data?.advisories ?? null,
      trip.countryAdm0,
    );
    const pick = (v: boolean | null) =>
      setAnswers((a) => {
        // Tapping the chosen chip again clears it, like the cabin (design 6.2).
        if (other.id in a && a[other.id] === v) {
          const rest = { ...a };
          delete rest[other.id];
          return rest;
        }
        return { ...a, [other.id]: v };
      });
    const statusText =
      l.status === 'ok' || l.status === 'short' || l.status === 'risky'
        ? ` · ${t(`layover.status.${l.status}`)}`
        : '';
    return (
      <View
        key={other.id}
        style={[
          styles.gap8,
          i > 0 && { borderTopWidth: 1, borderTopColor: palette.borderSubtle, paddingTop: 12 },
        ]}
        testID={`flight-connection-${other.id}`}
      >
        <Text style={[styles.body, { color: palette.textPrimary }]}>
          {c.nextId === id
            ? t('flight.connectionContinues', { prev: isolateLtr(otherNo), route })
            : t('flight.connectionContinuedBy', { next: isolateLtr(otherNo), route })}
        </Text>
        <Text
          style={[
            styles.callout,
            {
              color:
                l.status === 'missed' || l.status === 'invalid'
                  ? palette.textAlert
                  : palette.textPrimary,
            },
          ]}
          accessibilityValue={{ text: l.status }}
          testID={`flight-connection-${other.id}-wait`}
        >
          {l.status === 'missed'
            ? t('layover.missed')
            : l.status === 'invalid'
              ? t('layover.invalid')
              : l.minutes !== null
                ? `${t('layover.wait', { time: waitText(l.minutes, t), apt: isolateLtr(c.airport) })}${statusText}`
                : null}
        </Text>
        <Text
          style={[styles.caption, { color: palette.textSecondary }]}
          importantForAccessibility="no"
        >
          {t('sameBooking.question', { other: isolateLtr(otherNo) })}
        </Text>
        <View
          style={styles.chips}
          accessibilityRole="radiogroup"
          accessibilityLabel={t('sameBooking.question', { other: spellCode(otherNo) })}
          testID={`flight-same-booking-${other.id}`}
        >
          {chip(
            t('sameBooking.chipYes'),
            answer === true,
            () => pick(true),
            `flight-same-booking-${other.id}-yes`,
          )}
          {chip(
            t('sameBooking.chipNo'),
            answer === false,
            () => pick(false),
            `flight-same-booking-${other.id}-no`,
          )}
          {chip(
            t('sameBooking.chipUnknown'),
            touched && answers[other.id] === null,
            () => pick(null),
            `flight-same-booking-${other.id}-unknown`,
          )}
        </View>
        {answer === false ? (
          <InlineNotice
            text={t('layover.separate', {
              prev: isolateLtr(prev.numberInput || prev.number),
              next: isolateLtr(next.numberInput || next.number),
            })}
            colorScheme={colorScheme}
            testID={`flight-warning-separate-${other.id}`}
          />
        ) : null}
        {transit ? (
          <TransitNotice
            warning={transit}
            colorScheme={colorScheme}
            testID={`flight-warning-transit-${other.id}`}
          />
        ) : null}
      </View>
    );
  };

  const airportField = (side: 'origin' | 'destination') => {
    const p = values[side];
    const title = titleOf(p);
    return (
      <View>
        <Text
          style={[styles.caption, { color: palette.textSecondary }]}
          importantForAccessibility="no"
        >
          {t(`flight.${side}`)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t(`flight.${side}`)}, ${p ? `${title}, ${spellCode(p.iata)}` : t('flight.noDataA11y')}${errors[side] ? `, ${errorText(side)}` : ''}`}
          disabled={locked}
          onPress={() => setPicking(side)}
          style={({ pressed }) => [
            styles.input,
            styles.airport,
            {
              backgroundColor: pressed ? palette.pressed : palette.surface,
              borderColor: errors[side] ? palette.textAlert : palette.borderControl,
              borderWidth: errors[side] ? 2 : 1,
            },
          ]}
          testID={`flight-${side}`}
        >
          <Text
            style={[styles.value, { color: p ? palette.textPrimary : palette.textTertiary }]}
            numberOfLines={2}
          >
            {p
              ? isolateOwn(title ?? p.iata)
              : searchNotice === 'found'
                ? t('flight.noData')
                : t('flight.pickAirport')}
          </Text>
          {p ? (
            <Text
              style={[styles.code, { backgroundColor: palette.tag, color: palette.textPrimary }]}
            >
              {p.iata}
            </Text>
          ) : null}
          <NextIcon color={palette.textSecondary} size={16} />
        </Pressable>
        {errors[side] ? (
          <Text
            style={[styles.footnote, { color: palette.textAlert }]}
            testID={`flight-${side}-error`}
            accessibilityLiveRegion="polite"
          >
            {errorText(side)}
          </Text>
        ) : null}
      </View>
    );
  };

  const timeField = (side: 'dep' | 'arr') => {
    const airport = side === 'dep' ? values.origin : values.destination;
    const dateKey = side === 'dep' ? 'depDate' : 'arrDate';
    const timeKey = side === 'dep' ? 'depTime' : 'arrTime';
    const err = side === 'dep' ? errorText('depTime') : errorText('arrTime');
    const dst = dstText(side);
    return (
      <View style={styles.gap8}>
        <View style={styles.row2}>
          <View style={styles.cell}>
            <DateField
              label={t('flight.localDate')}
              value={values[dateKey] ? isolateLtr(dayMonthYear(values[dateKey]!)) : null}
              placeholder={empty}
              a11yLabel={`${t(`flight.${side === 'dep' ? 'departure' : 'arrival'}`)}, ${t('flight.localDate')}, ${values[dateKey] ? formatDate(values[dateKey]!, t) : t('flight.noDataA11y')}`}
              a11yHint={t('tripForm.dateHint')}
              disabled={locked}
              onPress={() => pickDate(dateKey)}
              colorScheme={colorScheme}
              testID={`flight-${side}-date`}
            />
          </View>
          <View style={styles.cell}>
            <DateField
              label={t('flight.localTime')}
              value={values[timeKey] ? isolateLtr(values[timeKey]!) : null}
              placeholder={empty}
              a11yLabel={`${t(`flight.${side === 'dep' ? 'departure' : 'arrival'}`)}, ${timeHelp(airport)}, ${values[timeKey] ?? t('flight.noDataA11y')}`}
              a11yHint={t('tripForm.dateHint')}
              error={err}
              help={timeHelp(airport)}
              disabled={locked || !airport}
              onPress={() => pickTime(timeKey)}
              icon={(color) => <ClockIcon color={color} />}
              colorScheme={colorScheme}
              testID={`flight-${side}-time`}
            />
          </View>
        </View>
        {dst ? (
          <InlineNotice
            text={dst}
            colorScheme={colorScheme}
            testID={`flight-warning-${side}-dst`}
          />
        ) : null}
      </View>
    );
  };

  const header = (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('flight.back')}
        onPress={requestClose}
        style={styles.close}
        testID="flight-screen-back"
      >
        <BackIcon color={palette.textPrimary} />
      </Pressable>
      <View style={styles.grow}>
        <Text
          style={[styles.barTitle, { color: palette.textPrimary }]}
          accessibilityRole="header"
          maxFontSizeMultiplier={2}
        >
          {t(editing ? 'flight.titleEdit' : 'flight.titleNew')}
        </Text>
        <Text style={[styles.footnote, { color: palette.textSecondary }]} numberOfLines={1}>
          {isolateOwn(trip.title)}
        </Text>
      </View>
    </View>
  );

  let body: ReactNode;
  if (step === 'search') {
    body = (
      <>
        {directionChips}
        <TextField
          label={t('flight.number')}
          value={values.numberInput}
          onChangeText={(text) => update({ numberInput: typingFlightNumber(text) })}
          onBlur={() => {
            const n = normalizeFlightNumber(values.numberInput);
            if (n) set({ numberInput: n });
          }}
          help={t('flight.numberHelp')}
          error={errorText('number')}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          autoFocus={!editing}
          editable={!locked}
          returnKeyType="next"
          style={styles.ltr}
          colorScheme={colorScheme}
          testID="flight-number"
        />
        <DateField
          label={t('flight.date')}
          value={values.date ? isolateLtr(dayMonthYear(values.date)) : null}
          placeholder={t('tripForm.pickDate')}
          a11yLabel={`${t('flight.date')}, ${values.date ? formatDate(values.date, t) : t('tripForm.notSet')}`}
          a11yHint={t('tripForm.dateHint')}
          help={t('flight.dateHelp')}
          error={errorText('date')}
          disabled={locked}
          onPress={() => pickDate('date')}
          colorScheme={colorScheme}
          testID="flight-date"
        />
        {offlineSearch ? (
          <InlineNotice
            text={t('flight.searchOffline')}
            colorScheme={colorScheme}
            testID="flight-notice-search-offline"
          />
        ) : null}
        <View style={styles.gap8}>
          <Button
            kind="primary"
            label={t('flight.search')}
            busy={busy === 'search'}
            busyLabel={t('flight.searching')}
            blocked={offlineSearch}
            onPress={() => void search()}
            colorScheme={colorScheme}
            testID="flight-search"
          />
          <Button
            kind="text"
            label={t('flight.manual')}
            disabled={locked}
            onPress={manual}
            colorScheme={colorScheme}
            testID="flight-manual"
          />
        </View>
      </>
    );
  } else if (step === 'legs') {
    body = (
      <>
        <Text style={[styles.body, { color: palette.textPrimary }]}>{t('flight.legsTitle')}</Text>
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.borderSubtle },
          ]}
          testID="flight-legs"
        >
          {legs.map((leg, i) => {
            const dep =
              leg.departure.scheduledUtc && leg.departure.timeZone
                ? zonedWall(leg.departure.timeZone, new Date(leg.departure.scheduledUtc))
                : null;
            const arr =
              leg.arrival.scheduledUtc && leg.arrival.timeZone
                ? zonedWall(leg.arrival.timeZone, new Date(leg.arrival.scheduledUtc))
                : null;
            const origin = byCode(leg.departure.iata);
            const dest = byCode(leg.arrival.iata);
            return (
              <Pressable
                key={`${leg.departure.iata}-${i}`}
                accessibilityRole="button"
                accessibilityLabel={t('flight.legA11y', {
                  origin: origin?.title ?? leg.departure.iata ?? '',
                  destination: dest?.title ?? leg.arrival.iata ?? '',
                  dep: dep?.time ?? t('flight.noDataA11y'),
                  arr: arr?.time ?? t('flight.noDataA11y'),
                })}
                onPress={() => chooseLeg(leg)}
                style={({ pressed }) => [
                  styles.leg,
                  i > 0 && { borderTopWidth: 1, borderTopColor: palette.borderSubtle },
                  pressed && { backgroundColor: palette.pressed },
                ]}
                testID={`flight-leg-${i}`}
              >
                <View style={styles.grow}>
                  <View style={styles.route}>
                    <Text style={[styles.codeText, { color: palette.textPrimary }]}>
                      {isolateLtr(leg.departure.iata ?? '—')}
                    </Text>
                    <NextIcon color={palette.textTertiary} size={16} />
                    <Text style={[styles.codeText, { color: palette.textPrimary }]}>
                      {isolateLtr(leg.arrival.iata ?? '—')}
                    </Text>
                  </View>
                  <Text style={[styles.footnote, { color: palette.textSecondary }]}>
                    {[origin?.title?.split(' · ')[0], dest?.title?.split(' · ')[0]]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <Text style={[styles.numeric, { color: palette.textPrimary }]}>
                    {isolateLtr(`${dep?.time ?? '—'} – ${arr?.time ?? '—'}`)}
                  </Text>
                </View>
                <NextIcon color={palette.textSecondary} size={16} />
              </Pressable>
            );
          })}
        </View>
        <Button
          kind="text"
          label={t('flight.manual')}
          onPress={manual}
          colorScheme={colorScheme}
          testID="flight-manual"
        />
      </>
    );
  } else {
    const past = warning('past');
    const outside = warning('outsideTrip');
    body = (
      <>
        {searchNoticeText ? (
          <InlineNotice
            text={searchNoticeText}
            colorScheme={colorScheme}
            testID={`flight-notice-${searchNotice === 'found' ? 'found' : searchNotice === 'notFound' ? 'not-found' : searchNotice === 'rateLimited' ? 'rate-limited' : 'unavailable'}`}
          />
        ) : null}
        {saveNoticeText ? (
          <InlineNotice
            text={saveNoticeText}
            colorScheme={colorScheme}
            testID="flight-save-notice"
          />
        ) : null}
        {past ? (
          <InlineNotice
            text={t('flight.warn.past')}
            colorScheme={colorScheme}
            testID="flight-warning-past"
          />
        ) : null}
        <View
          style={[styles.summary, { backgroundColor: palette.surface }]}
          testID="flight-summary"
        >
          <Text style={[styles.body, styles.grow, { color: palette.textPrimary }]}>
            {isolateLtr(`${values.numberInput} · ${values.date ? dayMonthYear(values.date) : ''}`)}
          </Text>
          {!editing ? (
            <Button
              kind="text"
              label={t('flight.change')}
              disabled={locked}
              onPress={() => setStep('search')}
              colorScheme={colorScheme}
              testID="flight-summary-change"
            />
          ) : null}
        </View>
        {outside ? (
          <InlineNotice
            text={t('flight.warn.outsideTrip', { range: isolateLtr(outsideRange) })}
            colorScheme={colorScheme}
            testID="flight-warning-outside-trip"
          />
        ) : null}
        {directionChips}
        <TextField
          label={t('flight.airline')}
          value={values.airline}
          onChangeText={(text) => update({ airline: text.slice(0, 60) })}
          placeholder={empty}
          editable={!locked}
          colorScheme={colorScheme}
          testID="flight-airline"
        />
        <Text style={[styles.title3, { color: palette.textPrimary }]} accessibilityRole="header">
          {t('flight.departure')}
        </Text>
        {airportField('origin')}
        {timeField('dep')}
        <View style={styles.row2}>
          <View style={styles.cell}>
            <TextField
              label={t('flight.terminal')}
              value={values.depTerminal}
              onChangeText={(text) => update({ depTerminal: typingCode(text, 8) })}
              placeholder={empty}
              autoCapitalize="characters"
              editable={!locked}
              style={styles.ltr}
              colorScheme={colorScheme}
              testID="flight-dep-terminal"
            />
          </View>
          <View style={styles.cell}>
            <TextField
              label={t('flight.gate')}
              value={values.depGate}
              onChangeText={(text) => update({ depGate: typingCode(text, 8) })}
              placeholder={empty}
              autoCapitalize="characters"
              editable={!locked}
              style={styles.ltr}
              colorScheme={colorScheme}
              testID="flight-dep-gate"
            />
          </View>
        </View>
        <Text style={[styles.title3, { color: palette.textPrimary }]} accessibilityRole="header">
          {t('flight.arrival')}
        </Text>
        {airportField('destination')}
        {timeField('arr')}
        <TextField
          label={t('flight.terminal')}
          value={values.arrTerminal}
          onChangeText={(text) => update({ arrTerminal: typingCode(text, 8) })}
          placeholder={empty}
          autoCapitalize="characters"
          editable={!locked}
          style={styles.ltr}
          colorScheme={colorScheme}
          testID="flight-arr-terminal"
        />
        {formLinks.length > 0 ? (
          <View style={styles.gap8} testID="flight-connection">
            <Text
              style={[styles.title3, { color: palette.textPrimary }]}
              accessibilityRole="header"
            >
              {t('flight.connectionTitle')}
            </Text>
            {formLinks.map(connectionBlock)}
          </View>
        ) : null}
        <Text style={[styles.title3, { color: palette.textPrimary }]} accessibilityRole="header">
          {t('flight.booking')}
        </Text>
        <View>
          <TextField
            label={t('flight.pnr')}
            value={values.pnr}
            onChangeText={(text) => update({ pnr: typingCode(text, 8) })}
            // Android doesn't restore the password type when it flips on a live
            // field with autoCapitalize: a new field each way (QA S5 #1).
            key={pnrShown ? 'pnr-shown' : 'pnr-hidden'}
            secureTextEntry={!pnrShown}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            textContentType="none"
            error={errorText('pnr')}
            editable={!locked}
            style={[styles.ltr, styles.secret]}
            colorScheme={colorScheme}
            testID="flight-pnr"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(pnrShown ? 'flight.pnrHide' : 'flight.pnrShow')}
            accessibilityState={{ expanded: pnrShown }}
            onPress={() => setPnrShown((s) => !s)}
            style={styles.eye}
            testID="flight-pnr-toggle"
          >
            <EyeIcon color={palette.textSecondary} open={pnrShown} />
          </Pressable>
        </View>
        <TextField
          label={t('flight.seat')}
          value={values.seat}
          onChangeText={(text) => update({ seat: typingCode(text, 4) })}
          autoCapitalize="characters"
          error={errorText('seat')}
          editable={!locked}
          style={styles.ltr}
          colorScheme={colorScheme}
          testID="flight-seat"
        />
        <View>
          <Text
            style={[styles.caption, { color: palette.textSecondary }]}
            importantForAccessibility="no"
          >
            {t('flight.class')}
          </Text>
          <View
            style={styles.chips}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('flight.class')}
          >
            {CABINS.map((c) =>
              chip(
                t(`flight.cabin.${c}`),
                values.cabin === c,
                () => update({ cabin: values.cabin === c ? null : c }),
                `flight-class-${c.replace('_', '-')}`,
              ),
            )}
          </View>
        </View>
        <Text style={[styles.footnote, { color: palette.textSecondary }]}>
          {t('flight.pnrPrivacy')}
        </Text>
        {editing ? (
          <View style={styles.deleteRow}>
            <Button
              kind="text"
              label={t('flight.delete')}
              icon={(color) => <TrashIcon color={color} size={20} />}
              busy={busy === 'delete'}
              disabled={locked && busy !== 'delete'}
              onPress={remove}
              colorScheme={colorScheme}
              testID="flight-delete"
            />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={requestClose}
    >
      <KeyboardAvoidingView
        style={[styles.screen, { backgroundColor: palette.canvas, paddingTop: insetsTop }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        testID="flight-screen"
      >
        <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        {header}
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
        {step === 'details' ? (
          <View
            style={[
              styles.footer,
              {
                paddingBottom: insetsBottom + 12,
                borderTopColor: palette.borderSubtle,
                backgroundColor: palette.canvas,
              },
            ]}
          >
            {saveNotice === 'gone' ? (
              <Button
                kind="primary"
                label={t('flight.close')}
                onPress={onClose}
                colorScheme={colorScheme}
                testID="flight-save"
              />
            ) : (
              <Button
                kind="primary"
                label={t('flight.save')}
                busy={busy === 'save'}
                busyLabel={t('flight.saving')}
                disabled={locked && busy !== 'save'}
                onPress={() => void save()}
                colorScheme={colorScheme}
                testID="flight-save"
              />
            )}
          </View>
        ) : null}
      </KeyboardAvoidingView>
      {picking ? (
        <AirportPicker
          tripAdm0={trip.countryAdm0}
          israelFirst={picking === 'origin' && values.direction === 'out'}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          insetsTop={insetsTop}
          insetsBottom={insetsBottom}
          onClose={() => setPicking(null)}
          onPick={(airport, title) => {
            // The time stays a local time at the new airport (design 5).
            update({ [picking]: pickedFrom(airport, title) });
            setPicking(null);
          }}
        />
      ) : null}
    </Modal>
  );
}

/** "20.12.2026" */
function dayMonthYear(date: string): string {
  return `${dayMonth(date)}.${date.slice(0, 4)}`;
}

function EyeIcon({ color, open }: { color: string; open: boolean }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path
        d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
      />
      {open ? null : <Path d="M4 4l16 16" stroke={color} strokeWidth={1.8} strokeLinecap="round" />}
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    minHeight: layout.formBarHeight,
    paddingEnd: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  barTitle: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, textAlign: 'left' },
  close: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  content: { padding: 16, gap: 20 },
  gap8: { gap: 8 },
  row2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { flexGrow: 1, flexBasis: layout.dateFieldMinWidth },
  caption: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
    textAlign: 'left',
  },
  title3: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 4,
    textAlign: 'left',
  },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  numeric: {
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  chipText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  ltr: { writingDirection: 'ltr', letterSpacing: 1.6 },
  secret: { paddingEnd: 56 },
  eye: {
    position: 'absolute',
    end: 4,
    top: 22,
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: { minHeight: 56, borderRadius: radius.xs * 2, paddingHorizontal: 14, paddingVertical: 12 },
  airport: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  code: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1.6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  codeText: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, letterSpacing: 1.6 },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  leg: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summary: {
    minHeight: 56,
    borderRadius: radius.md,
    paddingStart: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  deleteRow: { marginTop: 4 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
});
