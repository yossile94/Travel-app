/**
 * The country card's temperature field (sprint 3 AC-10, AC-13; design 1):
 * the daily average for this month at the area's climate point, the city
 * when there is one, and "Sources". Hidden when the area has no value or
 * the file can't be read; a skeleton only if loading takes over 150 ms.
 */
import { useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';

import { isolateOwn } from '@/features/globe/BoardingPassCard';
import { colors, fonts, type ColorScheme } from '@/theme/tokens';

import { useClimate } from './climateData';
import { SourcesSheet } from './SourcesSheet';
import { formatTemp, tempA11y } from './tempFormat';

interface Props {
  adm0: string;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  /** Today's local date ("YYYY-MM-DD"): the trips' shared "day changed" value (Raz, T5). */
  today: string;
}

export function CardTemperature({ adm0, colorScheme, reduceMotion, insetsBottom, today }: Props) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];
  const state = useClimate();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesLink = useRef<ComponentRef<typeof Pressable>>(null);
  const closeSources = () => {
    setSourcesOpen(false);
    // Focus goes back to "Sources" (design 1.3).
    const node = findNodeHandle(sourcesLink.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  };

  if (state.status === 'failed') return null;
  if (state.status === 'loading') {
    return state.showSkeleton ? (
      <View testID="card-temp-skeleton" importantForAccessibility="no-hide-descendants">
        <View style={[styles.bar, { width: 64, backgroundColor: palette.tag }]} />
        <View style={[styles.bar, styles.barValue, { width: 40, backgroundColor: palette.tag }]} />
      </View>
    ) : null;
  }
  const area = state.climate.area(adm0);
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
    <View testID="card-temp">
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('sources.linkA11y')}
        onPress={() => setSourcesOpen(true)}
        style={styles.sources}
        ref={sourcesLink}
        testID="card-sources"
      >
        <Text style={[styles.footnote, { color: palette.link }]}>{t('sources.link')}</Text>
      </Pressable>
      <SourcesSheet
        visible={sourcesOpen}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insetsBottom}
        onClose={closeSources}
      />
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
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  // A 48dp target that doesn't add 48dp to the card (design 1.1).
  sources: {
    minHeight: 48,
    minWidth: 48,
    marginVertical: -14,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  bar: { height: 12, borderRadius: 6, marginTop: 2 },
  barValue: { height: 18, marginTop: 6 },
});
