/**
 * Sprint 5 design 13: "Flights" in the trip form. Editing a trip: its flights
 * as rows that open FlightScreen, and "add". A flight saves on its own
 * (save_flight), apart from "save changes", and the help line says so. A new
 * or duplicated trip has no server row yet: only a help line.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { NextIcon, PlusIcon } from '@/components/icons';
import { isolateLtr } from '@/features/globe/BoardingPassCard';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { defaultDirection } from './flightFormRules';
import { byDeparture, FLIGHTS_PER_TRIP, type Direction, type Flight } from './flightModel';
import { FlightScreen, type FlightScreenTrip } from './FlightScreen';
import { refreshTripFlights, useTripFlights } from './flightsStore';
import { dayMonth, sideTimes } from './flightTime';

export function TripFormFlights({
  trip,
  saved,
  disabled,
  colorScheme,
  reduceMotion,
  insetsTop,
  insetsBottom,
}: {
  trip: FlightScreenTrip;
  /** The trip exists on the server (editing): flights can be added. */
  saved: boolean;
  disabled: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const data = useTripFlights(saved ? trip.id : null);
  const [screen, setScreen] = useState<{ flight: Flight | null; direction: Direction } | null>(
    null,
  );

  useEffect(() => {
    if (saved) void refreshTripFlights(trip.id);
  }, [saved, trip.id]);

  if (!saved) {
    return (
      <View style={styles.section}>
        <Text style={[styles.caption, { color: p.textSecondary }]} accessibilityRole="header">
          {t('flights.title')}
        </Text>
        <Text
          style={[styles.footnote, { color: p.textSecondary }]}
          testID="trip-form-flights-new-help"
        >
          {t('flights.newTripHelp')}
        </Text>
      </View>
    );
  }

  const flights = [...data.flights].sort(byDeparture);
  return (
    <View style={styles.section} testID="trip-form-flights">
      <Text style={[styles.caption, { color: p.textSecondary }]} accessibilityRole="header">
        {t('flights.title')}
      </Text>
      <View
        style={[
          styles.card,
          {
            backgroundColor: p.surface,
            borderColor: colorScheme === 'dark' ? p.borderSubtle : 'transparent',
          },
        ]}
      >
        {flights.map((f, i) => {
          const dep = sideTimes(f.depTz, f.depCountry, f.depSched, null);
          const line1 = `${t(`flight.dir.${f.direction}`)} · ${isolateLtr(f.number)} · ${isolateLtr(dayMonth(f.depDateLocal))}`;
          return (
            <Pressable
              key={f.id}
              accessibilityRole="button"
              accessibilityLabel={`${line1}, ${f.depIata}${f.arrIata ? ` – ${f.arrIata}` : ''}${dep.local ? `, ${dep.local}` : ''}`}
              disabled={disabled}
              onPress={() => setScreen({ flight: f, direction: f.direction })}
              style={({ pressed }) => [
                styles.row,
                i > 0 && { borderTopWidth: 1, borderTopColor: p.borderSubtle },
                pressed && { backgroundColor: p.pressed },
              ]}
              testID={`trip-form-flight-${f.id}`}
            >
              <View style={styles.grow}>
                <Text style={[styles.body, { color: p.textPrimary }]}>{line1}</Text>
                <Text style={[styles.footnote, { color: p.textSecondary }]}>
                  {isolateLtr(
                    `${f.depIata} → ${f.arrIata ?? '—'}${dep.local ? ` · ${dep.local}` : ''}`,
                  )}
                </Text>
              </View>
              <View style={I18nManager.isRTL ? styles.flip : undefined}>
                <NextIcon color={p.textTertiary} size={16} />
              </View>
            </Pressable>
          );
        })}
        {flights.length >= FLIGHTS_PER_TRIP ? (
          <Text
            style={[styles.footnote, styles.limit, { color: p.textSecondary }]}
            testID="trip-form-flight-limit"
          >
            {t('flight.limit')}
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => setScreen({ flight: null, direction: defaultDirection(flights) })}
            style={({ pressed }) => [
              styles.add,
              flights.length > 0 && { borderTopWidth: 1, borderTopColor: p.borderSubtle },
              pressed && { backgroundColor: p.pressed },
            ]}
            testID="trip-form-flight-add"
          >
            <PlusIcon color={p.link} size={20} />
            <Text style={[styles.bodyStrong, { color: p.link }]}>{t('flights.add')}</Text>
          </Pressable>
        )}
      </View>
      <Text style={[styles.footnote, { color: p.textSecondary }]} testID="trip-form-flights-help">
        {t('flights.formHelp')}
      </Text>
      {screen ? (
        <FlightScreen
          trip={trip}
          flight={screen.flight}
          direction={screen.direction}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          insetsTop={insetsTop}
          insetsBottom={insetsBottom}
          onClose={() => setScreen(null)}
          onSaved={() => {
            setScreen(null);
            void refreshTripFlights(trip.id);
          }}
          onDeleted={() => {
            setScreen(null);
            void refreshTripFlights(trip.id);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  add: {
    minHeight: layout.touchTargetMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  limit: { padding: 14 },
  grow: { flex: 1 },
  flip: { transform: [{ scaleX: -1 }] },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
});
