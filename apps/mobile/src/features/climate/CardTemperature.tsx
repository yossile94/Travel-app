/**
 * The country card's temperature field (sprint 3 AC-10, AC-13; design 1):
 * the daily average for this month at the area's climate point, and the city
 * when there is one ("Sources" is the card's own, sprint 4). Hidden when the area has no value or
 * the file can't be read; a skeleton only if loading takes over 150 ms.
 */
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { isolateOwn } from '@/features/globe/BoardingPassCard';
import { colors, fonts, type ColorScheme } from '@/theme/tokens';

import { useClimate } from './climateData';
import { formatTemp, tempA11y } from './tempFormat';

interface Props {
  adm0: string;
  colorScheme: ColorScheme;
  /** Today's local date ("YYYY-MM-DD"): the trips' shared "day changed" value (Raz, T5). */
  today: string;
  /**
   * A city chosen in search (sprint 9 AC-12, design 10.3): its value and name
   * when it has one; otherwise the area's point with its own city.
   */
  city?: { id: number; nameHe: string; nameEn: string } | null;
}

export function CardTemperature({ adm0, colorScheme, today, city: chosen = null }: Props) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];
  const state = useClimate();

  if (state.status === 'failed') return null;
  if (state.status === 'loading') {
    return state.showSkeleton ? (
      <View testID="card-temp-skeleton" importantForAccessibility="no-hide-descendants">
        <View style={[styles.bar, { width: 64, backgroundColor: palette.tag }]} />
        <View style={[styles.bar, styles.barValue, { width: 40, backgroundColor: palette.tag }]} />
      </View>
    ) : null;
  }
  const chosenNormals = chosen ? state.climate.city(chosen.id) : null;
  const area = chosenNormals ? { normals: chosenNormals, city: chosen } : state.climate.area(adm0);
  if (!area) return null;

  const month = Number(today.slice(5, 7));
  const value = area.normals[month - 1]!;
  const label = t('climate.cardLabel', { month: t(`months.${month}`) });
  const city = area.city
    ? i18n.language === 'he' && area.city.nameHe
      ? area.city.nameHe
      : isolateOwn(area.city.nameEn)
    : null;

  return (
    <View style={styles.block} testID="card-temp">
      <View
        accessible
        accessibilityLabel={
          city
            ? t('climate.cardA11y', { label, value: tempA11y(value, t), city })
            : t('climate.cardA11yNoCity', { label, value: tempA11y(value, t) })
        }
      >
        <Text style={[styles.label, { color: palette.textSecondary }]}>{label}</Text>
        <Text style={[styles.value, { color: palette.textPrimary }]} testID="card-temp-value">
          {formatTemp(value, t)}
        </Text>
        {city ? (
          <Text style={[styles.sub, { color: palette.textSecondary }]} testID="card-temp-city">
            {city}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  value: {
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  sub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  block: { marginTop: 20 },
  bar: { height: 12, borderRadius: 6, marginTop: 2 },
  barValue: { height: 18, marginTop: 6 },
});
