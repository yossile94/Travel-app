/**
 * "Why it matches" in the country card (sprint 9 AC-7, design 9): the same
 * reasons as the row, then the flight hours, as neutral chips (a green
 * "level 2" would read as "safe"). A country that doesn't match says the
 * first rule it fails, on its own climate point (design 9.3, Raz).
 */
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, type ColorScheme } from '@/theme/tokens';

import type { DiscoverFilters, DiscoverResult } from './discover';
import { failureText, formatFlightHours, reasonTexts } from './discoverText';

interface Props {
  result: DiscoverResult;
  filters: DiscoverFilters;
  colorScheme: ColorScheme;
}

export function CardMatch({ result, filters, colorScheme }: Props) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];

  if (!result.match) {
    const why = failureText(result, filters, t);
    if (!why) return null;
    return (
      <View
        style={styles.block}
        accessible
        testID="card-match"
        accessibilityValue={{ text: 'nomatch' }}
      >
        <Text accessibilityRole="header" style={[styles.caption, { color: palette.textSecondary }]}>
          {t('discover.not.title')}
        </Text>
        <Text style={[styles.callout, { color: palette.textSecondary }]} testID="card-match-not">
          {why}
        </Text>
      </View>
    );
  }

  const hours = formatFlightHours(result.reasons.hours, t);
  const chips = [
    ...reasonTexts(result, filters, t, i18n.language),
    { kind: 'hours' as const, text: hours, a11y: t('discover.hoursFlight', { hours }) },
  ];
  return (
    <View
      style={styles.block}
      accessible
      accessibilityLabel={t('discover.card.a11y', { list: chips.map((c) => c.a11y).join(', ') })}
      accessibilityValue={{ text: 'match' }}
      testID="card-match"
    >
      <Text style={[styles.caption, { color: palette.textSecondary }]}>
        {t('discover.card.title')}
      </Text>
      <View style={styles.chips}>
        {chips.map((c) => (
          <View
            key={c.kind}
            style={[styles.chip, { backgroundColor: palette.tag }]}
            testID={`card-match-${c.kind}`}
          >
            <Text style={[styles.chipText, { color: palette.textPrimary }]}>{c.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 12 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  callout: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'left',
    marginTop: 2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
});
