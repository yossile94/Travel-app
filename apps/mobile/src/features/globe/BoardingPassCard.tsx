import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  I18nManager,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { colors, fonts, highlightColor, motion, type ColorScheme } from '@/theme/tokens';

import { boardingPassPath } from './boardingPassPath';
import type { CountryInfo } from './countryData';
import { describeDifference, differenceFromIsrael, formatClock, zonedClock } from './localTime';
import { SplitFlap } from './SplitFlap';
import { timeDifferenceText } from './timeDifferenceText';
import { useMinuteClock } from './useMinuteClock';

const STUB_WIDTH = 108;
const NOTCH_RADIUS = 11;
const CORNER_RADIUS = 18;
const DECELERATE = Easing.bezier(0.05, 0.7, 0.1, 1);

interface Props {
  country: CountryInfo;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  onClose: () => void;
  /** Reports the card's height so the camera can lift the globe above it. */
  onHeight?: (height: number) => void;
}

/** The country card from design direction C: a boarding pass (sprint 0 AC-4). */
export function BoardingPassCard({ country, colorScheme, reduceMotion, onClose, onHeight }: Props) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const dark = colorScheme === 'dark';
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Slide up from below (or fade, with reduced motion) when the card appears.
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(
      withTiming(1, {
        duration: reduceMotion ? motion.short : motion.sheet,
        easing: reduceMotion ? Easing.linear : DECELERATE,
      }),
    );
  }, [progress, reduceMotion]);
  const enter = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: progress.value }
      : { transform: [{ translateY: (1 - progress.value) * (size.height + 40) }] },
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
    onHeight?.(height);
  };

  const notchX = I18nManager.isRTL ? STUB_WIDTH : size.width - STUB_WIDTH;

  return (
    <Animated.View style={[styles.card, enter]} onLayout={onLayout} testID="country-card">
      {size.width > 0 && (
        <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill}>
          <Path
            d={boardingPassPath(size.width, size.height, {
              cornerRadius: CORNER_RADIUS,
              notchX,
              notchRadius: NOTCH_RADIUS,
            })}
            fill={palette.surface}
            stroke={dark ? 'rgba(163,179,219,0.16)' : 'transparent'}
          />
          <Line
            x1={notchX}
            y1={NOTCH_RADIUS + 4}
            x2={notchX}
            y2={size.height - NOTCH_RADIUS - 4}
            stroke={dark ? 'rgba(244,231,208,0.22)' : 'rgba(18,28,54,0.22)'}
            strokeWidth={2}
            strokeDasharray="6 5"
          />
        </Svg>
      )}

      <View style={styles.row}>
        <View style={styles.main}>
          <View style={[styles.strip, { backgroundColor: highlightColor }]} />
          <Text style={[styles.label, { color: palette.textSecondary }]}>
            {t('card.destination')}
          </Text>
          <Text style={[styles.nameHe, { color: palette.textPrimary }]} accessibilityRole="header">
            {country.nameHe}
          </Text>
          <Text style={[styles.nameEn, { color: palette.textSecondary }]}>{country.nameEn}</Text>

          <View style={styles.fields}>
            {country.timeZone && <LocalTime country={country} colorScheme={colorScheme} />}
            {country.currency && (
              <View testID="card-currency">
                <Text style={[styles.label, { color: palette.textSecondary }]}>
                  {t('card.currency')}
                </Text>
                <Text style={[styles.value, { color: palette.textPrimary }]}>
                  {country.currency.nameHe}
                </Text>
                <Text style={[styles.sub, styles.ltr, { color: palette.textSecondary }]}>
                  {country.currency.symbol === country.currency.code
                    ? country.currency.code
                    : `${country.currency.symbol} · ${country.currency.code}`}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.stub}>
          <SplitFlap
            text={country.adm0}
            reduceMotion={reduceMotion}
            dark={dark}
            accessibilityLabel={t('card.code', { code: country.adm0 })}
          />
          <Svg width={80} height={30} style={styles.barcode}>
            {[0, 3, 5, 9, 12, 14, 18, 21, 23, 27, 30, 32, 36, 39, 41, 45, 48, 50, 54, 57].map(
              (x, i) => (
                <Rect
                  key={x}
                  x={x * 1.4}
                  y={0}
                  width={i % 3 === 0 ? 3 : 1.5}
                  height={30}
                  fill={palette.textPrimary}
                  opacity={0.85}
                />
              ),
            )}
          </Svg>
        </View>
      </View>

      <Pressable
        onPress={onClose}
        style={styles.close}
        accessibilityRole="button"
        accessibilityLabel={t('card.close')}
        hitSlop={4}
        testID="card-close"
      >
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Path
            d="M6 6l12 12M18 6L6 18"
            stroke={palette.textPrimary}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </Svg>
      </Pressable>
    </Animated.View>
  );
}

function LocalTime({ country, colorScheme }: { country: CountryInfo; colorScheme: ColorScheme }) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const now = useMinuteClock();
  const timeZone = country.timeZone!;

  return (
    <View testID="card-time">
      <Text style={[styles.label, { color: palette.textSecondary }]}>
        {country.city ? t('card.localTimeIn', { city: country.city }) : t('card.localTime')}
      </Text>
      <Text style={[styles.clock, styles.ltr, { color: palette.textPrimary }]}>
        {formatClock(zonedClock(timeZone, now))}
      </Text>
      <Text style={[styles.sub, { color: palette.textSecondary }]} testID="card-time-difference">
        {timeDifferenceText(t, describeDifference(differenceFromIsrael(timeZone, now)))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    start: 12,
    end: 12,
    bottom: 30,
    minHeight: 168,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 12 },
  },
  row: { flexDirection: 'row' },
  main: { flex: 1, paddingTop: 22, paddingBottom: 16, paddingHorizontal: 20 },
  strip: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
    height: 4,
    borderTopStartRadius: CORNER_RADIUS,
  },
  stub: {
    width: STUB_WIDTH,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 54,
    paddingBottom: 14,
    gap: 8,
  },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  nameHe: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, marginTop: 4, textAlign: 'left' },
  nameEn: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  fields: { flexDirection: 'row', gap: 20, marginTop: 12 },
  clock: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 26, fontVariant: ['tabular-nums'] },
  value: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  sub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  ltr: { writingDirection: 'ltr' },
  barcode: { marginTop: 'auto' },
  close: {
    position: 'absolute',
    top: 6,
    end: STUB_WIDTH + 6,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
