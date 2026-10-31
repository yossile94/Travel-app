/**
 * Sprint 11 design 2.2 – 2.4: two short sections in an open trip row, after
 * the hotels — "Itinerary" (today's or the first planned day, a summary and
 * the button) and "What to see" (the screen, and the saved places).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/fields';
import { ChevronEndIcon, MapPinIcon } from '@/components/icons';
import { useTripFlights } from '@/features/flights/flightsStore';
import { isolateOwn } from '@/features/globe/BoardingPassCard';
import { countryByAdm0 } from '@/features/globe/countryData';
import { BookmarkIcon } from '@/features/places/icons';
import { PlacesScreen } from '@/features/places/PlacesScreen';
import { useSaved } from '@/features/places/savedPlaces';
import { countryName } from '@/features/trips/countryName';
import type { Trip } from '@/features/trips/tripsApi';
import { useReduceMotion } from '@/features/globe/useReduceMotion';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { dayHeading } from './dayText';
import { boardCounts, flightAnchors, itineraryDays } from './itineraryModel';
import { useBoard } from './itineraryStore';
import { ItineraryScreen } from './ItineraryScreen';

export function ItinerarySection({
  trip,
  today,
  offline,
  colorScheme,
  onToast,
}: {
  trip: Trip;
  today: string;
  offline: boolean;
  colorScheme: ColorScheme;
  onToast: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion() === true;
  const state = useBoard(trip.id);
  const flights = useTripFlights(trip.id).flights;
  const [open, setOpen] = useState(false);
  const board = useMemo(
    () =>
      itineraryDays({
        trip,
        anchors: flightAnchors(flights),
        items: state.status === 'ready' ? state.items : [],
        today,
      }),
    [trip, flights, state, today],
  );
  const counts = boardCounts(board);
  const past = trip.endDate < today;
  const active = trip.startDate <= today && today <= trip.endDate;
  const shownDay = active
    ? board.days.find((d) => d.isToday)
    : board.days.find((d) => d.items.length > 0);

  let body;
  if (state.status === 'loading') body = null;
  else if (state.status === 'failed') {
    body = (
      <Text style={[styles.footnote, { color: p.textSecondary }]}>
        {t(state.offline ? 'itinerary.notCached' : 'itinerary.loadError')}
      </Text>
    );
  } else if (past) {
    body = null;
  } else if (board.total === 0) {
    body = (
      <Text style={[styles.callout, { color: p.textSecondary }]}>{t('itinerary.kitEmpty')}</Text>
    );
  } else if (shownDay) {
    const heading = dayHeading(t, i18n.language, shownDay.index, shownDay.date);
    body = (
      <View style={styles.gap}>
        <Text style={[styles.footnote, { color: p.textSecondary }]}>
          {shownDay.isToday ? t('itinerary.todayPrefix', { day: heading }) : heading}
        </Text>
        {shownDay.items.length === 0 ? (
          <Text style={[styles.callout, { color: p.textSecondary }]}>
            {t('itinerary.noneToday')}
          </Text>
        ) : (
          shownDay.items.slice(0, 3).map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <Text style={[styles.time, { color: p.textPrimary }]}>
                {item.time ? `⁦${item.time}⁩` : '—'}
              </Text>
              <Text
                style={[styles.callout, styles.grow, { color: p.textPrimary }]}
                numberOfLines={1}
              >
                {isolateOwn(item.title)}
              </Text>
              {item.source === 'auto' ? (
                <Text style={[styles.chip, { backgroundColor: p.tag, color: p.textSecondary }]}>
                  {t('itinerary.auto')}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </View>
    );
  }

  return (
    <View style={styles.section} testID="kit-itinerary">
      <Text style={[styles.caption, { color: p.textSecondary }]} accessibilityRole="header">
        {t('itinerary.kitTitle')}
      </Text>
      <View style={[styles.card, { backgroundColor: p.surface, borderColor: p.borderSubtle }]}>
        {body}
        <View style={styles.footer}>
          <Button
            kind="secondary"
            label={t('itinerary.open')}
            blocked={offline && state.status === 'failed'}
            onPress={() =>
              offline && state.status === 'failed'
                ? onToast(t('offline.readOnlyHint'))
                : setOpen(true)
            }
            colorScheme={colorScheme}
            testID="kit-itinerary-open"
          />
          <Text style={[styles.footnote, { color: p.textSecondary }]}>
            {past
              ? t('itinerary.summaryPast', {
                  days: t('itinerary.summaryDays', { count: counts.days }),
                  n: t('itinerary.summaryItems', { count: board.total }),
                })
              : t('itinerary.summary', {
                  days: t('itinerary.summaryDays', { count: counts.days }),
                  planned: t('itinerary.summaryPlanned', { count: counts.planned }),
                })}
          </Text>
        </View>
      </View>
      {open ? (
        <ItineraryScreen
          trip={trip}
          today={today}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}

export function PlacesSection({
  trip,
  today,
  hasHotels,
  colorScheme,
  onToast,
}: {
  trip: Trip;
  today: string;
  hasHotels: boolean;
  colorScheme: ColorScheme;
  onToast: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion() === true;
  const saved = useSaved(trip.id);
  const [open, setOpen] = useState<'city' | 'saved' | null>(null);
  const country = countryByAdm0(trip.countryAdm0);
  const area = country ? countryName(country, i18n.language) : trip.countryAdm0;
  const count = saved.status === 'ready' ? saved.places.length : 0;
  if (trip.countryAdm0 === 'ISR') return null;
  const row = (
    icon: React.ReactNode,
    title: string,
    sub: string | null,
    value: string | null,
    onPress: () => void,
    testID: string,
    a11y?: string,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? [title, sub].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: p.pressed }]}
      testID={testID}
    >
      {icon}
      <View style={styles.grow}>
        <Text style={[styles.body, { color: p.textPrimary }]}>{title}</Text>
        {sub ? <Text style={[styles.footnote, { color: p.textSecondary }]}>{sub}</Text> : null}
      </View>
      {value ? <Text style={[styles.body, { color: p.textSecondary }]}>{value}</Text> : null}
      <ChevronEndIcon color={p.textTertiary} />
    </Pressable>
  );
  return (
    <View style={styles.section} testID="kit-places">
      <Text style={[styles.caption, { color: p.textSecondary }]} accessibilityRole="header">
        {t('places.kitTitle')}
      </Text>
      <View
        style={[
          styles.card,
          styles.flush,
          { backgroundColor: p.surface, borderColor: p.borderSubtle },
        ]}
      >
        {row(
          <MapPinIcon color={p.textSecondary} size={20} />,
          t('places.title', { country: area }),
          t(hasHotels ? 'places.kitSubAll' : 'places.kitSubCities'),
          null,
          () => setOpen('city'),
          'kit-places-open',
        )}
        {count > 0 ? (
          row(
            <BookmarkIcon color={p.textSecondary} size={20} />,
            t('places.kitSaved'),
            null,
            `⁦${count}⁩`,
            () => setOpen('saved'),
            'kit-places-saved',
            t('places.kitSavedA11y', { n: count }),
          )
        ) : (
          <Text style={[styles.footnote, styles.help, { color: p.textSecondary }]}>
            {t('places.kitSavedHelp')}
          </Text>
        )}
      </View>
      {open ? (
        <PlacesScreen
          adm0={trip.countryAdm0}
          trip={trip}
          signedIn
          today={today}
          initialTab={open}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 12 },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: 12, gap: 8 },
  flush: { padding: 0, overflow: 'hidden' },
  gap: { gap: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: {
    width: 52,
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  listRow: {
    minHeight: layout.listRowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  grow: { flex: 1 },
  help: { paddingHorizontal: 16, paddingBottom: 12 },
  chip: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
});
