/**
 * Sprint 11 F-030, F-031 (design 9 – 14, 20): a trip's board. A day for each
 * date, labelled by the flights; the activities in order; "+ add" per day;
 * an actions menu (edit, up, down, move to a day, navigate, delete), also as
 * TalkBack actions on the row; "Plan automatically" that fills only empty
 * days, applied atomically on the server. Offline, the board shows the device
 * copy, read only.
 */
import { randomUUID } from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/fields';
import { InlineNotice, useToast } from '@/components/formControls';
import { BackIcon, MapPinIcon, PlusIcon } from '@/components/icons';
import { useClimate } from '@/features/climate/climateData';
import { useTripFlights } from '@/features/flights/flightsStore';
import { isolateOwn } from '@/features/globe/BoardingPassCard';
import { useTripKit } from '@/features/kit/kitStore';
import { navigateUrl } from '@/features/places/PlacesScreen';
import { usePlaces } from '@/features/places/placesData';
import { nightCityId } from '@/features/places/placesModel';
import { useSaved } from '@/features/places/savedPlaces';
import { cityPoint } from '@/features/trips/citiesData';
import { countryName } from '@/features/trips/countryName';
import { countryByAdm0 } from '@/features/globe/countryData';
import type { Trip } from '@/features/trips/tripsApi';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';
import { logTransition } from '@/features/globe/perfLog';

import { ActivityScreen, confirmDelete, type ActivityTarget } from './ActivityScreen';
import { dayHeading } from './dayText';
import {
  DAY_MAX,
  flightAnchors,
  itineraryDays,
  moveWithinDay,
  TRIP_MAX,
  type BoardDay,
  type Item,
} from './itineraryModel';
import { applyPlan, moveItem, useBoard, type PlannedOut } from './itineraryStore';
import { planInput } from './planInput';
import { planTrip, type DayKind, type Pace } from './planner';

export function ItineraryScreen({
  trip,
  today,
  colorScheme,
  reduceMotion,
  insetsTop,
  insetsBottom,
  onClose,
}: {
  trip: Trip;
  today: string;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  // QA B1: the board is a Modal, so its toasts are drawn inside it.
  const toast = useToast();
  const onToast = toast.say;
  const p = colors[colorScheme];
  const state = useBoard(trip.id);
  const flights = useTripFlights(trip.id).flights;
  const anchors = useMemo(() => flightAnchors(flights), [flights]);
  const items = useMemo(() => (state.status === 'ready' ? state.items : []), [state]);
  const board = useMemo(
    () => itineraryDays({ trip, anchors, items, today }),
    [trip, anchors, items, today],
  );
  const readOnly = state.status === 'ready' && state.fromCache;
  const saved = useSaved(trip.id);
  const places = usePlaces(trip.countryAdm0);
  const kit = useTripKit(trip.id);
  const climate = useClimate();
  const [form, setForm] = useState<ActivityTarget | null>(null);
  const [menu, setMenu] = useState<{ item: Item; day: BoardDay | null } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  const indexOf = (date: string) => board.days.find((d) => d.date === date)?.index ?? 0;
  const country = countryByAdm0(trip.countryAdm0);
  const area = country ? countryName(country, i18n.language) : trip.countryAdm0;
  const full = board.total >= TRIP_MAX;
  /** The night's trip city by name (3.7.3), for the summary. */
  const cityOf = (day: string) => {
    const id = nightCityId(trip, kit.hotels, day, cityPoint);
    return id === null ? null : (trip.cities.find((c) => c.geonameId === id)?.name ?? null);
  };
  const blockedHint = () => onToast(t('offline.readOnlyHint'));

  const labelText = (d: BoardDay) => {
    if (!d.label) return null;
    const key = {
      arrival_full: 'arrivalFull',
      arrival_short: 'arrivalShort',
      arrival_evening: 'arrivalEvening',
      arrival_rest: 'arrivalRest',
      in_transit: 'inTransit',
      departure_airport: 'departureAirport',
      departure_short: 'departureShort',
    }[d.label.kind];
    return t(`itinerary.label.${key}`, { time: d.label.time ? `⁦${d.label.time}⁩` : '' });
  };

  const sections = [
    ...board.days.map((d) => ({ key: d.date, day: d as BoardDay | null, data: d.items })),
    ...(board.outOfRange.length ? [{ key: 'out', day: null, data: board.outOfRange }] : []),
  ];

  const move = async (item: Item, day: string, position: number) => {
    if (readOnly) return blockedHint();
    const r = await moveItem(trip.id, item.id, day, position);
    if (r === 'ok') onToast(t('itinerary.moved', { n: indexOf(day) }));
    else if (r === 'limit') onToast(t('itinerary.dayLimit'));
    else if (r === 'offline') blockedHint();
    else onToast(t('itinerary.moveError'));
  };

  return (
    <Modal
      visible
      animationType={reduceMotion ? 'fade' : 'slide'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[styles.screen, { backgroundColor: p.canvas, paddingTop: insetsTop }]}
        onLayout={() => logTransition('itinerary')}
        testID="itinerary-screen"
      >
        <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('flight.back')}
            onPress={onClose}
            style={styles.back}
            testID="itinerary-back"
          >
            <BackIcon color={p.textPrimary} />
          </Pressable>
          <View style={styles.grow}>
            <Text style={[styles.title3, { color: p.textPrimary }]} accessibilityRole="header">
              {t('itinerary.title')}
            </Text>
            <Text style={[styles.footnote, { color: p.textSecondary }]} numberOfLines={1}>
              {trip.title}
            </Text>
          </View>
        </View>

        {state.status === 'failed' ? (
          <View style={styles.pad}>
            <InlineNotice
              text={t(state.offline ? 'itinerary.notCached' : 'itinerary.loadError')}
              colorScheme={colorScheme}
            />
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled
            initialNumToRender={12}
            windowSize={7}
            contentContainerStyle={{ paddingBottom: insetsBottom + 24 }}
            ListHeaderComponent={
              <View style={styles.pad}>
                {readOnly ? (
                  <InlineNotice
                    text={t('offline.readOnly')}
                    colorScheme={colorScheme}
                    testID="itinerary-offline"
                  />
                ) : null}
                {board.outOfRange.length ? (
                  <InlineNotice
                    text={t('itinerary.outOfRangeNotice', { n: board.outOfRange.length })}
                    colorScheme={colorScheme}
                    testID="itinerary-out-notice"
                  />
                ) : null}
                {!board.hasFlights ? (
                  <InlineNotice
                    text={t('itinerary.noFlights')}
                    colorScheme={colorScheme}
                    testID="itinerary-no-flights"
                  />
                ) : null}
                {full ? (
                  <InlineNotice text={t('itinerary.tripLimit')} colorScheme={colorScheme} />
                ) : null}
                {trip.endDate >= today ? (
                  <View>
                    <Button
                      kind="secondary"
                      label={t('planner.button')}
                      a11yLabel={t('planner.buttonA11y')}
                      blocked={readOnly}
                      onPress={() => (readOnly ? blockedHint() : setPlanning(true))}
                      colorScheme={colorScheme}
                      testID="planner-button"
                    />
                    <Text style={[styles.footnote, { color: p.textSecondary }]}>
                      {t('planner.buttonSub')}
                    </Text>
                  </View>
                ) : null}
                {result ? (
                  <View
                    style={[styles.result, { backgroundColor: p.infoBg }]}
                    accessibilityLiveRegion="polite"
                    testID="planner-result"
                  >
                    {result.map((line, i) => (
                      <Text
                        key={i}
                        style={[i === 0 ? styles.bodyStrong : styles.footnote, { color: p.infoFg }]}
                      >
                        {line}
                      </Text>
                    ))}
                    <Button
                      kind="text"
                      label={t('planner.closeResult')}
                      onPress={() => setResult(null)}
                      colorScheme={colorScheme}
                      testID="planner-result-close"
                    />
                  </View>
                ) : null}
              </View>
            }
            renderSectionHeader={({ section }) =>
              section.day ? (
                <View
                  style={[
                    styles.dayHeader,
                    { backgroundColor: p.canvas, borderBottomColor: p.borderSubtle },
                  ]}
                  accessibilityRole="header"
                  testID={`day-${section.day.date}`}
                >
                  <Text
                    style={[
                      styles.bodyStrong,
                      styles.grow,
                      {
                        color:
                          section.day.label?.kind === 'in_transit'
                            ? p.textSecondary
                            : p.textPrimary,
                      },
                    ]}
                  >
                    {dayHeading(t, i18n.language, section.day.index, section.day.date)}
                  </Text>
                  {section.day.isToday ? (
                    <Text
                      style={[
                        styles.chip,
                        {
                          backgroundColor: p.successSubtleBg,
                          color: p.successSubtleFg,
                        },
                      ]}
                    >
                      {t('itinerary.today')}
                    </Text>
                  ) : null}
                  {labelText(section.day) ? (
                    <Text
                      style={[styles.chip, { backgroundColor: p.tag, color: p.textSecondary }]}
                      testID={`day-label-${section.day.date}`}
                    >
                      {labelText(section.day)}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <View
                  style={[
                    styles.dayHeader,
                    { backgroundColor: p.canvas, borderBottomColor: p.borderSubtle },
                  ]}
                  accessibilityRole="header"
                  testID="day-out"
                >
                  <Text style={[styles.bodyStrong, { color: p.textPrimary }]}>
                    {t('itinerary.outOfRange', { n: board.outOfRange.length })}
                  </Text>
                </View>
              )
            }
            renderItem={({ item, section }) => (
              <ActivityRow
                item={item}
                day={section.day}
                colorScheme={colorScheme}
                onOpen={() => setForm({ kind: 'edit', item })}
                onMenu={() => setMenu({ item, day: section.day })}
                onMove={(delta) => {
                  if (!section.day) return;
                  const at = moveWithinDay(section.day, item.id, delta);
                  if (at !== null) void move(item, section.day.date, at);
                }}
              />
            )}
            renderSectionFooter={({ section }) =>
              section.day ? (
                <View style={styles.dayFooter}>
                  {section.day.items.length === 0 ? (
                    <Text style={[styles.callout, { color: p.textSecondary }]}>
                      {section.day.label?.kind === 'in_transit'
                        ? t('itinerary.emptyTransit')
                        : section.day.label?.kind === 'arrival_rest'
                          ? t('itinerary.emptyRest')
                          : t('itinerary.emptyDay')}
                    </Text>
                  ) : null}
                  {section.day.items.length >= DAY_MAX ? (
                    <Text style={[styles.footnote, { color: p.textSecondary }]}>
                      {t('itinerary.dayLimit')}
                    </Text>
                  ) : !full ? (
                    <Button
                      kind="link"
                      label={t('itinerary.add')}
                      icon={(c) => <PlusIcon color={c} size={20} />}
                      blocked={readOnly}
                      onPress={() =>
                        readOnly ? blockedHint() : setForm({ kind: 'new', day: section.day!.date })
                      }
                      colorScheme={colorScheme}
                      testID={`day-add-${section.day.date}`}
                    />
                  ) : null}
                </View>
              ) : null
            }
          />
        )}

        {form ? (
          <ActivityScreen
            target={form}
            trip={trip}
            dayIndexOf={indexOf}
            saved={saved.status === 'ready' ? saved.places : []}
            places={places.status === 'ready' ? places.places : []}
            readOnly={readOnly}
            colorScheme={colorScheme}
            insetsTop={insetsTop}
            insetsBottom={insetsBottom}
            onClose={() => setForm(null)}
            onDone={(toast) => {
              setForm(null);
              onToast(toast);
            }}
          />
        ) : null}

        {menu ? (
          <ActivityMenu
            item={menu.item}
            day={menu.day}
            days={board.days}
            readOnly={readOnly}
            colorScheme={colorScheme}
            reduceMotion={reduceMotion}
            insetsBottom={insetsBottom}
            onClose={() => setMenu(null)}
            onEdit={() => {
              setMenu(null);
              setForm({ kind: 'edit', item: menu.item });
            }}
            onMove={(day, position) => {
              setMenu(null);
              void move(menu.item, day, position);
            }}
            onDelete={() => {
              setMenu(null);
              confirmDelete(t, trip.id, menu.item, menu.day ? menu.day.index : null, (r) =>
                onToast(
                  r === 'ok'
                    ? t('activity.deleted')
                    : r === 'offline'
                      ? t('offline.readOnlyHint')
                      : t('activity.saveError'),
                ),
              );
            }}
          />
        ) : null}

        {planning ? (
          <AutoPlanSheet
            onPlan={async (pace) => {
              if (places.status !== 'ready')
                return { kind: 'error' as const, text: t('planner.downloading') };
              if (places.places.length === 0)
                return { kind: 'error' as const, text: t('planner.noPlaces', { country: area }) };
              const input = planInput({
                trip,
                board,
                anchors,
                hotels: kit.hotels,
                places: places.places,
                pointOf: cityPoint,
                today,
                normals:
                  climate.status === 'ready'
                    ? (climate.climate.area(trip.countryAdm0)?.normals ?? null)
                    : null,
                pace,
                language: i18n.language,
                airportTitle: t('planner.airportTitle'),
                newId: () => randomUUID(),
              });
              const plan = planTrip(input);
              const out: PlannedOut[] = plan.items.map((i) => ({
                id: i.id,
                day: i.day,
                time: i.time,
                title: i.title,
                placeRef: i.placeRef,
                placeName: i.placeName,
                lat: i.lat,
                lng: i.lng,
                order: i.order,
              }));
              if (out.length === 0) return { kind: 'error' as const, text: t('planner.noEmpty') };
              const applied = await applyPlan(trip.id, out);
              if (applied.result !== 'ok') {
                return {
                  kind: 'error' as const,
                  text: t(
                    applied.result === 'offline'
                      ? 'planner.offline'
                      : applied.result === 'limit'
                        ? 'planner.overTripLimit'
                        : 'planner.error',
                  ),
                };
              }
              const filled = new Set(out.map((i) => i.day));
              for (const s of applied.skipped) filled.delete(s.date);
              setPlanning(false);
              setResult(
                resultLines(
                  t,
                  plan.days,
                  applied.skipped,
                  filled.size,
                  applied.inserted,
                  indexOf,
                  cityOf,
                ),
              );
              onToast(t('planner.done', { n: filled.size }));
              return { kind: 'done' as const };
            }}
            preview={(pace) => {
              if (places.status !== 'ready') return null;
              const plan = planTrip(
                planInput({
                  trip,
                  board,
                  anchors,
                  hotels: kit.hotels,
                  places: places.places,
                  pointOf: cityPoint,
                  today,
                  normals: null,
                  pace,
                  language: i18n.language,
                  airportTitle: '',
                  newId: (i) => String(i),
                }),
              );
              return {
                days: plan.days.filter((d) => d.kind === 'planned').length,
                kept: plan.days.filter((d) => d.kind === 'busy').length,
                over60: plan.days.some((d) => d.kind === 'beyondLimit'),
              };
            }}
            colorScheme={colorScheme}
            reduceMotion={reduceMotion}
            insetsBottom={insetsBottom}
            onClose={() => setPlanning(false)}
          />
        ) : null}
        {toast.render(insetsTop + 64)}
      </View>
    </Modal>
  );
}

/** Design 11.3: the summary, a line per day that wasn't filled and why. */
function resultLines(
  t: ReturnType<typeof useTranslation>['t'],
  days: readonly { day: string; kind: DayKind }[],
  serverSkipped: readonly { date: string; reason: string }[],
  filledDays: number,
  inserted: number,
  indexOf: (day: string) => number,
  cityOf: (day: string) => string | null,
): string[] {
  const lines = [
    filledDays
      ? t('planner.doneDetail', { n: filledDays, items: inserted })
      : t('planner.doneNone'),
  ];
  const reasons: string[] = [];
  const key: Partial<Record<DayKind, string>> = {
    busy: 'planner.skip.hasItems',
    inTransit: 'planner.skip.inTransit',
    arrivalEvening: 'planner.skip.arrivalEvening',
    rest: 'planner.skip.rest',
    placesUsed: 'planner.skip.placesUsed',
  };
  for (const d of days) {
    const k = key[d.kind];
    const n = indexOf(d.day);
    const city = cityOf(d.day);
    if (d.kind === 'noPlaces' || (d.kind === 'placesUsed' && !city)) {
      // D23: by the night's city when there is one; else the destination.
      reasons.push(
        city ? t('planner.skip.noPlaces', { n, city }) : t('planner.skip.noPlacesTrip', { n }),
      );
    } else if (k) reasons.push(t(k, { n, city }));
  }
  for (const s of serverSkipped) {
    if (s.reason === 'filled_meanwhile')
      reasons.push(t('planner.skip.filledMeanwhile', { n: indexOf(s.date) }));
  }
  const over = days.filter((d) => d.kind === 'beyondLimit');
  if (over.length) {
    reasons.push(
      t('planner.skip.overLimit', { from: indexOf(over[0]!.day), to: indexOf(over.at(-1)!.day) }),
    );
  }
  if (reasons.length) lines.push(t('planner.skipped'), ...reasons.map((r) => `• ${r}`));
  return lines;
}

function ActivityRow({
  item,
  day,
  colorScheme,
  onOpen,
  onMenu,
  onMove,
}: {
  item: Item;
  day: BoardDay | null;
  colorScheme: ColorScheme;
  onOpen: () => void;
  onMenu: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const at = day ? day.items.findIndex((i) => i.id === item.id) : -1;
  const actions = [
    { name: 'activate', label: t('itinerary.menu.edit') },
    ...(day && at > 0 ? [{ name: 'up', label: t('itinerary.menu.upA11y') }] : []),
    ...(day && at < day.items.length - 1
      ? [{ name: 'down', label: t('itinerary.menu.downA11y') }]
      : []),
    { name: 'menu', label: t('itinerary.menu.moveTo') },
  ];
  const second = [
    item.placeName && item.placeName !== item.title ? item.placeName : null,
    item.note,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[styles.row, { backgroundColor: p.surface, borderBottomColor: p.borderSubtle }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[
          item.time ?? '',
          item.title,
          item.source === 'auto' ? t('itinerary.auto') : null,
          second || null,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint={t('itinerary.rowHint')}
        accessibilityActions={actions}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'up') onMove(-1);
          else if (e.nativeEvent.actionName === 'down') onMove(1);
          else if (e.nativeEvent.actionName === 'menu') onMenu();
          else onOpen();
        }}
        onPress={onOpen}
        style={styles.rowMain}
        testID={`activity-${item.id}`}
      >
        <Text style={[styles.time, { color: item.time ? p.textPrimary : p.textTertiary }]}>
          {item.time ? `⁦${item.time}⁩` : '—'}
        </Text>
        <View style={styles.grow}>
          <Text style={[styles.bodyStrong, { color: p.textPrimary }]} numberOfLines={3}>
            {isolateOwn(item.title)}
          </Text>
          {second ? (
            <View style={styles.secondLine}>
              {item.placeName ? <MapPinIcon color={p.textSecondary} size={12} /> : null}
              <Text style={[styles.footnote, { color: p.textSecondary }]} numberOfLines={1}>
                {second}
              </Text>
            </View>
          ) : null}
        </View>
        {item.source === 'auto' ? (
          <Text
            style={[styles.chip, { backgroundColor: p.tag, color: p.textSecondary }]}
            testID={`activity-auto-${item.id}`}
          >
            {t('itinerary.auto')}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('itinerary.more', { title: item.title })}
        onPress={onMenu}
        style={styles.iconButton}
        testID={`activity-menu-${item.id}`}
      >
        <Text style={[styles.more, { color: p.textSecondary }]}>⋮</Text>
      </Pressable>
    </View>
  );
}

/** Design 14: the actions, then "move to day" as a second step in the same sheet. */
function ActivityMenu({
  item,
  day,
  days,
  readOnly,
  colorScheme,
  reduceMotion,
  insetsBottom,
  onClose,
  onEdit,
  onMove,
  onDelete,
}: {
  item: Item;
  day: BoardDay | null;
  days: readonly BoardDay[];
  /** Offline (the device copy): only "navigate" works (Raz design decision 4). */
  readOnly: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
  onEdit: () => void;
  onMove: (day: string, position: number) => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const [step, setStep] = useState<'actions' | 'days'>('actions');
  const at = day ? day.items.findIndex((i) => i.id === item.id) : -1;
  const row = (label: string, onPress: () => void, testID: string, disabled = false) => (
    <Pressable
      key={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        { borderBottomColor: p.borderSubtle },
        pressed && { backgroundColor: p.pressed },
      ]}
      testID={testID}
    >
      <Text style={[styles.body, { color: disabled ? p.textTertiary : p.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <BottomSheet
      visible
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={onClose}
      maxHeight={640}
      testID="activity-menu"
    >
      <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
        {step === 'actions' ? isolateOwn(item.title) : t('itinerary.menu.moveTitle')}
      </Text>
      {step === 'actions' ? (
        <View>
          {row(t('itinerary.menu.edit'), onEdit, 'menu-edit', readOnly)}
          {day
            ? row(
                t('itinerary.menu.up'),
                () => onMove(day.date, at - 1),
                'menu-up',
                readOnly || at <= 0,
              )
            : null}
          {day
            ? row(
                t('itinerary.menu.down'),
                () => onMove(day.date, at + 1),
                'menu-down',
                readOnly || at >= day.items.length - 1,
              )
            : null}
          {row(t('itinerary.menu.moveTo'), () => setStep('days'), 'menu-move', readOnly)}
          {item.lat !== null && item.lng !== null
            ? row(
                t('itinerary.menu.navigate'),
                () =>
                  void Linking.openURL(
                    navigateUrl({
                      lat: item.lat!,
                      lng: item.lng!,
                      name: item.placeName ?? item.title,
                    }),
                  ).catch(() => {}),
                'menu-navigate',
              )
            : null}
          {row(t('itinerary.menu.delete'), onDelete, 'menu-delete', readOnly)}
        </View>
      ) : (
        <ScrollView>
          {days.map((d) => {
            const isFull = d.items.length >= DAY_MAX && d.date !== day?.date;
            return row(
              `${dayHeading(t, i18n.language, d.index, d.date)}${isFull ? ` · ${t('itinerary.menu.full')}` : ''}`,
              () => onMove(d.date, d.items.length),
              `menu-day-${d.date}`,
              isFull,
            );
          })}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

/** Design 11.1: the pace, the preview count, the limitation, and the one button. */
function AutoPlanSheet({
  onPlan,
  preview,
  colorScheme,
  reduceMotion,
  insetsBottom,
  onClose,
}: {
  onPlan: (pace: Pace) => Promise<{ kind: 'done' } | { kind: 'error'; text: string }>;
  preview: (pace: Pace) => { days: number; kept: number; over60: boolean } | null;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const [pace, setPace] = useState<Pace>('calm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = useMemo(() => preview(pace), [preview, pace]);
  const go = async () => {
    setBusy(true);
    setError(null);
    const r = await onPlan(pace);
    setBusy(false);
    if (r.kind === 'error') setError(r.text);
  };
  return (
    <BottomSheet
      visible
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={onClose}
      maxHeight={640}
      testID="planner-sheet"
    >
      <ScrollView>
        <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
          {t('planner.title')}
        </Text>
        <Text style={[styles.body, { color: p.textPrimary }]}>{t('planner.intro')}</Text>
        <Text style={[styles.label, { color: p.textSecondary }]}>{t('planner.pace')}</Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('planner.pace')}
          style={styles.gap}
        >
          {(['calm', 'intense'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: pace === value }}
              onPress={() => setPace(value)}
              style={[
                styles.pace,
                pace === value
                  ? { borderColor: p.primary, borderWidth: 2, backgroundColor: p.secondaryBg }
                  : { borderColor: p.borderControl, borderWidth: 1 },
              ]}
              testID={`planner-pace-${value}`}
            >
              <Text style={[styles.bodyStrong, { color: p.textPrimary }]}>
                {t(value === 'calm' ? 'planner.relaxed' : 'planner.intense')}
              </Text>
              <Text style={[styles.footnote, { color: p.textSecondary }]}>
                {t(value === 'calm' ? 'planner.relaxedSub' : 'planner.intenseSub')}
              </Text>
            </Pressable>
          ))}
        </View>
        {counts ? (
          <Text style={[styles.callout, { color: p.textPrimary }]} testID="planner-preview">
            {t('planner.preview', { n: counts.days, kept: counts.kept })}
          </Text>
        ) : (
          <Text style={[styles.callout, { color: p.textSecondary }]}>
            {t('planner.downloading')}
          </Text>
        )}
        {counts?.over60 ? (
          <Text style={[styles.footnote, { color: p.textSecondary }]}>{t('planner.over60')}</Text>
        ) : null}
        <Text style={[styles.footnote, styles.limitation, { color: p.textSecondary }]}>
          {t('planner.limitation')}
        </Text>
        {error ? (
          <InlineNotice text={error} colorScheme={colorScheme} testID="planner-error" />
        ) : null}
        <Button
          kind="primary"
          label={
            counts?.days === 1 ? t('planner.goOne') : t('planner.go', { n: counts?.days ?? 0 })
          }
          busy={busy}
          busyLabel={t('planner.busy')}
          onPress={() => void go()}
          colorScheme={colorScheme}
          testID="planner-go"
        />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    minHeight: layout.formBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingEnd: 16,
    gap: 4,
  },
  back: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  gap: { gap: 8 },
  dayHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayFooter: { paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
  chip: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingStart: 16,
    paddingVertical: 10,
  },
  time: {
    width: 56,
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  secondLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  more: { fontSize: 24, lineHeight: 28 },
  result: { borderRadius: radius.md, padding: 12, gap: 4 },
  menuRow: {
    minHeight: layout.listRowMin,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pace: { minHeight: 64, borderRadius: radius.md, padding: 12, justifyContent: 'center' },
  limitation: { marginVertical: 12 },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 12,
    textAlign: 'left',
  },
  title2: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    textAlign: 'left',
  },
  title3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
});
