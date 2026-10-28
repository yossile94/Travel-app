/**
 * The discovery chips over the globe (sprint 9 AC-1, design 2–4): three
 * toggles, and under them the one month picker and the weather type. On
 * the globe the "on" state always uses the dark theme's pair (design 2.3:
 * the globe is always dark).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  CalendarIcon,
  ChevronDownIcon,
  CloudOffIcon,
  PeopleIcon,
  PlaneUpIcon,
  SunIcon,
} from '@/components/icons';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import type { DiscoverFilters, Weather } from './discover';
import { WEATHER_TYPES, weatherTestId } from './discoverText';

const ON = { bg: colors.dark.primary, fg: colors.dark.onPrimary };
const ICON = 16;

function Check({ color }: { color: string }) {
  return (
    <Svg width={ICON} height={ICON} viewBox="0 0 24 24">
      <Path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke={color}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

interface ChipProps {
  label: string;
  colorScheme: ColorScheme;
  on: boolean;
  disabled?: boolean;
  icon?: (color: string) => ReactNode;
  end?: (color: string) => ReactNode;
  role: 'togglebutton' | 'radio' | 'button';
  a11yLabel?: string;
  a11yHint?: string;
  onPress: () => void;
  testID: string;
  /** For E2E: on / off / disabled, or the month number. */
  value?: string;
}

/** One chip on the globe: off, on, or disabled-but-explains (design 2.3). */
export function GlobeChip({
  label,
  colorScheme,
  on,
  disabled = false,
  icon,
  end,
  role,
  a11yLabel,
  a11yHint,
  onPress,
  testID,
  value,
}: ChipProps) {
  const palette = colors[colorScheme];
  const fg = disabled ? palette.disabledFg : on ? ON.fg : palette.chromeFg;
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={a11yLabel ?? label}
      accessibilityHint={a11yHint}
      accessibilityState={
        role === 'button'
          ? { disabled }
          : role === 'radio'
            ? { checked: on }
            : { checked: on, disabled }
      }
      accessibilityValue={{ text: value ?? (disabled ? 'disabled' : on ? 'on' : 'off') }}
      hitSlop={{ top: layout.discoverChipHitSlop, bottom: layout.discoverChipHitSlop }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        disabled
          ? { backgroundColor: palette.disabledBg }
          : on
            ? { backgroundColor: ON.bg }
            : {
                backgroundColor: palette.chromeBg,
                borderColor: palette.chromeBorder,
                borderWidth: 1,
                elevation: colorScheme === 'dark' ? 0 : 3,
              },
        pressed && styles.pressed,
      ]}
    >
      {disabled ? (
        <CloudOffIcon color={fg} size={ICON} />
      ) : on && role !== 'button' ? (
        <Check color={fg} />
      ) : (
        icon?.(fg)
      )}
      <Text
        style={[styles.text, { color: fg }]}
        maxFontSizeMultiplier={layout.discoverChipMaxFontScale}
        numberOfLines={1}
      >
        {label}
      </Text>
      {end?.(fg)}
    </Pressable>
  );
}

interface Props {
  colorScheme: ColorScheme;
  top: number;
  filters: DiscoverFilters;
  /** No advisories copy at all: the family chip explains instead (design 11.2). */
  familyUnavailable: boolean;
  onFamily: () => void;
  onWeather: () => void;
  onNear: () => void;
  onMonth: () => void;
  onType: (w: Weather | null) => void;
}

/** Design 2.1: the chips row, and the refine row when a chip needs the month. */
export function DiscoverChips({
  colorScheme,
  top,
  filters,
  familyUnavailable,
  onFamily,
  onWeather,
  onNear,
  onMonth,
  onType,
}: Props) {
  const { t } = useTranslation();
  const month = t(`months.${filters.month + 1}`);
  const refine = filters.family || filters.weatherOn;
  return (
    <View style={[styles.rows, { top }]} pointerEvents="box-none">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="toolbar"
        accessibilityLabel={t('discover.chips')}
        keyboardShouldPersistTaps="handled"
        testID="discover-chips"
      >
        <GlobeChip
          label={t('discover.chipFamily')}
          colorScheme={colorScheme}
          on={filters.family}
          disabled={familyUnavailable}
          role="togglebutton"
          a11yHint={familyUnavailable ? t('discover.familyUnavailable') : undefined}
          icon={(c) => <PeopleIcon color={c} size={ICON} />}
          onPress={onFamily}
          testID="discover-chip-family"
        />
        <GlobeChip
          label={t('discover.chipWeather')}
          colorScheme={colorScheme}
          on={filters.weatherOn}
          role="togglebutton"
          a11yLabel={
            filters.weatherOn
              ? filters.weather
                ? t('discover.chipWeatherA11y', {
                    month,
                    type: t(`discover.type.${filters.weather}`),
                  })
                : t('discover.chipWeatherA11yNoType', { month })
              : undefined
          }
          icon={(c) => <SunIcon color={c} size={ICON} />}
          onPress={onWeather}
          testID="discover-chip-weather"
        />
        <GlobeChip
          label={t('discover.chipNear')}
          colorScheme={colorScheme}
          on={filters.near}
          role="togglebutton"
          icon={(c) => <PlaneUpIcon color={c} size={ICON} />}
          onPress={onNear}
          testID="discover-chip-near"
        />
      </ScrollView>
      {refine ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.row, styles.refine]}
          keyboardShouldPersistTaps="handled"
          testID="discover-refine"
        >
          <GlobeChip
            label={month}
            colorScheme={colorScheme}
            on={false}
            role="button"
            a11yLabel={t('discover.monthA11y', { month })}
            a11yHint={t('discover.monthHint')}
            icon={(c) => <CalendarIcon color={c} size={ICON} />}
            end={(c) => <ChevronDownIcon color={c} size={ICON} />}
            onPress={onMonth}
            testID="discover-month"
            value={String(filters.month + 1)}
          />
          {filters.weatherOn ? (
            <View
              style={styles.types}
              accessibilityRole="radiogroup"
              accessibilityLabel={t('discover.types')}
            >
              {WEATHER_TYPES.map((w) => {
                const on = filters.weather === w;
                return (
                  <GlobeChip
                    key={w}
                    label={t(`discover.type.${w}`)}
                    colorScheme={colorScheme}
                    on={on}
                    role="radio"
                    a11yHint={on ? t('discover.typeHint') : undefined}
                    onPress={() => onType(on ? null : w)}
                    testID={`discover-type-${weatherTestId(w)}`}
                  />
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { position: 'absolute', start: 0, end: 0 },
  row: {
    flexDirection: 'row',
    gap: layout.discoverChipGap,
    paddingHorizontal: layout.chromeEdge,
    paddingVertical: layout.discoverChipHitSlop,
  },
  refine: { marginTop: layout.discoverRefineTop - layout.discoverChipsTop - 48 },
  types: { flexDirection: 'row', gap: layout.discoverChipGap },
  chip: {
    height: layout.discoverChipHeight,
    paddingHorizontal: layout.discoverChipPadding,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pressed: { opacity: 0.85 },
  text: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
});
