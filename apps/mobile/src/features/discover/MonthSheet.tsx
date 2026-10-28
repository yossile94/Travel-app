/**
 * The one month picker (sprint 9 AC-1, design 3.2): twelve months, January
 * first, no year. A tap picks and closes; back closes it first (it is modal).
 */
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

interface Props {
  visible: boolean;
  month: number;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onPick: (month: number) => void;
  onClose: () => void;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i);

export function MonthSheet({
  visible,
  month,
  colorScheme,
  reduceMotion,
  insetsBottom,
  onPick,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const { fontScale } = useWindowDimensions();
  const palette = colors[colorScheme];
  // Design 3.2: two columns at 200%.
  const columns = fontScale > 1.5 ? 2 : 3;
  return (
    <BottomSheet
      visible={visible}
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={onClose}
      testID="discover-month-sheet"
    >
      <Text accessibilityRole="header" style={[styles.title, { color: palette.textPrimary }]}>
        {t('discover.monthTitle')}
      </Text>
      <Text style={[styles.sub, { color: palette.textSecondary }]}>{t('discover.monthSub')}</Text>
      <View
        style={styles.grid}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('discover.month')}
      >
        {MONTHS.map((m) => {
          const checked = m === month;
          return (
            <Pressable
              key={m}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              onPress={() => onPick(m)}
              style={({ pressed }) => [
                styles.cell,
                { width: `${100 / columns - 2}%` },
                checked
                  ? { backgroundColor: palette.primary, borderColor: palette.primary }
                  : { borderColor: palette.borderControl },
                pressed && !checked && { backgroundColor: palette.pressed },
              ]}
              testID={`discover-month-${m + 1}`}
            >
              <Text
                style={[
                  styles.cellText,
                  { color: checked ? palette.onPrimary : palette.textPrimary },
                ]}
              >
                {checked ? '✓ ' : ''}
                {t(`months.${m + 1}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    marginEnd: 48,
    textAlign: 'left',
  },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginTop: 2, textAlign: 'left' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
    marginTop: 16,
    marginBottom: 8,
  },
  cell: {
    minHeight: layout.discoverMonthCellMin,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cellText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, textAlign: 'center' },
});
