/**
 * The temperature in a trip's open row (sprint 3 AC-11, design 3.2): the
 * calendar months the trip touches, at the first of its cities with a value,
 * else at the area's climate point. 1 month: one value; 2-3: a column each;
 * 4 or more: the range. Hidden when there is no value.
 */
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { isolateOwn } from '@/features/globe/BoardingPassCard';
import type { TripCity } from '@/features/trips/tripsApi';
import { colors, fonts, type ColorScheme } from '@/theme/tokens';

import { useClimate, type Climate } from './climateData';
import { formatTemp, formatTempRange, tempA11y, tempRangeA11y, tripMonths } from './tempFormat';

interface Props {
  countryAdm0: string;
  startDate: string;
  endDate: string;
  cities: TripCity[];
  colorScheme: ColorScheme;
}

/** The trip's climate point (AC-11): its normals and the city to name, if any. */
export function tripClimatePoint(
  climate: Climate,
  countryAdm0: string,
  cities: TripCity[],
  language: string,
): { normals: number[]; city: string | null } | null {
  for (const city of cities) {
    const normals = city.geonameId ? climate.city(city.geonameId) : null;
    // The saved name in its own direction: an English or typed name inside Hebrew (Raz, T6).
    if (normals) return { normals, city: isolateOwn(city.name) };
  }
  const area = climate.area(countryAdm0);
  if (!area) return null;
  const name = area.city
    ? language === 'he' && area.city.nameHe
      ? area.city.nameHe
      : isolateOwn(area.city.nameEn)
    : null;
  return { normals: area.normals, city: name };
}

export function TripTemperature({ countryAdm0, startDate, endDate, cities, colorScheme }: Props) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];
  const state = useClimate();
  if (state.status !== 'ready') return null;
  const point = tripClimatePoint(state.climate, countryAdm0, cities, i18n.language);
  if (!point) return null;

  const months = tripMonths(startDate, endDate);
  const values = months.map((m) => point.normals[m]!);
  const monthName = (m: number) => t(`months.${m + 1}`);
  const label =
    months.length === 1
      ? t('climate.cardLabel', { month: monthName(months[0]!) })
      : months.length <= 3
        ? t('climate.tripLabel')
        : t('climate.tripLabelRange');
  const spoken =
    months.length >= 4
      ? tempRangeA11y(values, t)
      : months
          .map((m, i) =>
            t('climate.tripA11yMonth', { month: monthName(m), value: tempA11y(values[i]!, t) }),
          )
          .join(', ');
  const a11y = [
    months.length === 1 ? `${label}: ${tempA11y(values[0]!, t)}` : `${label}: ${spoken}`,
  ]
    .concat(point.city ? [point.city] : [])
    .join(', ');

  return (
    <View accessible accessibilityLabel={a11y} testID="trip-temp">
      <Text style={[styles.caption, { color: palette.textSecondary }]}>{label}</Text>
      {months.length === 1 ? (
        <Text style={[styles.value, { color: palette.textPrimary }]}>
          {formatTemp(values[0]!, t)}
        </Text>
      ) : months.length <= 3 ? (
        <View style={styles.columns}>
          {months.map((m, i) => (
            <View key={m}>
              <Text style={[styles.caption, { color: palette.textSecondary }]}>{monthName(m)}</Text>
              <Text style={[styles.value, { color: palette.textPrimary }]}>
                {formatTemp(values[i]!, t)}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.value, { color: palette.textPrimary }]}>
          {formatTempRange(values, t)}
        </Text>
      )}
      {point.city ? (
        <Text style={[styles.footnote, { color: palette.textSecondary }]}>{point.city}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  value: {
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  columns: { flexDirection: 'row', gap: 20, marginTop: 2 },
});
