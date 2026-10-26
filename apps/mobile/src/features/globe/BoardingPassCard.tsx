import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  I18nManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { CardTemperature } from '@/features/climate/CardTemperature';
import { CardRateBlock, CardSafety, CardSources } from '@/features/destination/CardDestination';
import { todayPg } from '@/features/trips/tripDates';
import { colors, fonts, highlightColor, layout, motion, type ColorScheme } from '@/theme/tokens';

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
const ACCELERATE = Easing.bezier(0.3, 0, 1, 1);
/** Space between the card and the bottom inset (Android navigation bar). */
export const CARD_GAP = 16;

/**
 * Whether the English name keeps its letter spacing. Android measures a
 * spaced line without the spacing, so a name too long for its line was
 * ellipsized short and then cut at its start ("H GEORGIA …", sprint 1 QA).
 * A name keeps the spacing only when it surely fits the measured row;
 * otherwise it drops it, and Android ellipsizes it correctly at its end.
 * iOS measures spacing correctly and always keeps it.
 */
export function spaceEnglishName(
  name: string,
  fontScale: number,
  rowWidth: number,
  os: typeof Platform.OS = Platform.OS,
): boolean {
  if (os !== 'android') return true;
  return rowWidth > 0 && name.length * layout.cardNameEnSpacedCharWidth * fontScale <= rowWidth;
}

interface Props {
  country: CountryInfo;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  /** Safe-area bottom inset, so the card sits above Android's navigation bar. */
  bottomInset: number;
  onClose: () => void;
  /** Reports the card's height so the camera can lift the globe above it. */
  onHeight?: (height: number) => void;
  /** Steps aside (slides down, or fades with reduced motion) while search is open (sprint 1 design 2.4). */
  hidden?: boolean;
  /** Safe-area top inset: the card never grows over the controls row and the status pill. */
  topInset?: number;
  /**
   * The coupon under the pass (sprint 2 design 2.1), given how tall its list
   * may grow before it scrolls.
   */
  coupon?: (maxListHeight: number) => ReactNode;
  /** Today's local date, from the trips' shared "day changed" event (sprint 3 AC-6, AC-10). */
  today?: string;
}

/** The coupon's fixed parts around its list: padding, heading and "New trip" (design 2.1). */
const COUPON_CHROME = 12 + 16 + 16 + 12 + 48 + 4;

/** The country card from design direction C: a boarding pass (sprint 0 AC-4). */
export function BoardingPassCard({
  country,
  colorScheme,
  reduceMotion,
  bottomInset,
  onClose,
  onHeight,
  hidden = false,
  topInset = 0,
  coupon,
  today = todayPg(),
}: Props) {
  const { t } = useTranslation();
  const { fontScale, height: windowHeight } = useWindowDimensions();
  const [passHeight, setPassHeight] = useState(0);
  // Design 2.1: the whole card stays below insets.top + 112 + 48.
  const maxListHeight =
    windowHeight -
    (topInset + layout.overlayTop + layout.touchTargetMin) -
    (bottomInset + CARD_GAP) -
    passHeight -
    COUPON_CHROME;
  const [nameEnWidth, setNameEnWidth] = useState(0);
  const palette = colors[colorScheme];
  const dark = colorScheme === 'dark';
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Slide up from below (or fade, with reduced motion) when the card appears,
  // and back down when search takes the screen (200 ms, accelerating).
  // The fades are the reduced-motion version, so they run even then:
  // Reanimated's default (ReduceMotion.System) would skip them.
  const progress = useSharedValue(0);
  useEffect(() => {
    if (hidden) {
      progress.set(
        withTiming(0, {
          duration: motion.short,
          easing: reduceMotion ? Easing.linear : ACCELERATE,
          reduceMotion: ReduceMotion.Never,
        }),
      );
      return;
    }
    progress.set(
      withTiming(
        1,
        reduceMotion
          ? { duration: motion.short, easing: Easing.linear, reduceMotion: ReduceMotion.Never }
          : { duration: motion.sheet, easing: DECELERATE },
      ),
    );
  }, [progress, reduceMotion, hidden]);
  // Hidden until measured, so the first frame doesn't flash in place before sliding up.
  const enter = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: progress.value }
      : {
          opacity: size.height > 0 ? 1 : 0,
          transform: [{ translateY: (1 - progress.value) * (size.height + 40) }],
        },
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
    onHeight?.(height);
  };

  const notchX = I18nManager.isRTL ? STUB_WIDTH : size.width - STUB_WIDTH;

  return (
    <Animated.View
      style={[styles.card, { bottom: bottomInset + CARD_GAP }, enter]}
      onLayout={onLayout}
      pointerEvents={hidden ? 'none' : 'auto'}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={hidden}
      testID="country-card"
    >
      {size.width > 0 && (
        <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill}>
          <Path
            d={boardingPassPath(size.width, size.height, {
              cornerRadius: CORNER_RADIUS,
              notchX,
              notchRadius: NOTCH_RADIUS,
              couponY: coupon && passHeight > 0 ? passHeight : undefined,
            })}
            fill={palette.surfaceRaised}
            stroke={dark ? 'rgba(163,179,219,0.16)' : 'transparent'}
          />
          <Line
            x1={notchX}
            y1={NOTCH_RADIUS + 4}
            x2={notchX}
            y2={coupon && passHeight > 0 ? passHeight - 4 : size.height - NOTCH_RADIUS - 4}
            stroke={dark ? 'rgba(244,231,208,0.22)' : 'rgba(18,28,54,0.22)'}
            strokeWidth={2}
            strokeDasharray="6 5"
          />
          {coupon && passHeight > 0 ? (
            <Line
              x1={NOTCH_RADIUS + 4}
              y1={passHeight}
              x2={size.width - NOTCH_RADIUS - 4}
              y2={passHeight}
              stroke={dark ? 'rgba(244,231,208,0.22)' : 'rgba(18,28,54,0.22)'}
              strokeWidth={2}
              strokeDasharray="6 5"
            />
          ) : null}
        </Svg>
      )}

      <View style={styles.row} onLayout={(event) => setPassHeight(event.nativeEvent.layout.height)}>
        <View style={styles.main}>
          <View style={[styles.strip, { backgroundColor: highlightColor }]} />
          <Text style={[styles.label, { color: palette.textSecondary }]}>
            {t('card.destination')}
          </Text>
          {/* AC-11: at most two lines; long names step down a size, and the
              full name stays in the label for the screen reader. */}
          <Text
            style={[
              styles.nameHe,
              country.nameHe.length > layout.cardNameStepDownChars && styles.nameHeLong,
              styles.clearOfClose,
              { color: palette.textPrimary },
            ]}
            accessibilityRole="header"
            accessibilityLabel={country.nameHe}
            numberOfLines={2}
            ellipsizeMode="tail"
            maxFontSizeMultiplier={1.6}
            testID="card-name"
          >
            {country.nameHe}
          </Text>
          {/* The inner row is laid out left to right even in Hebrew: in an
              RTL layout Android ellipsized the English name from the wrong end
              ("H GEORGIA …", sprint 1 QA). The outer view keeps the app's
              direction, so the space for the close button stays on its side. */}
          <View style={styles.clearOfClose}>
            <View
              style={styles.nameEnRow}
              onLayout={(event) => setNameEnWidth(event.nativeEvent.layout.width)}
            >
              <Text
                style={[
                  styles.nameEn,
                  !spaceEnglishName(country.nameEn, fontScale, nameEnWidth) && styles.nameEnTight,
                  { color: palette.textSecondary },
                ]}
                accessibilityLabel={country.nameEn}
                numberOfLines={1}
                ellipsizeMode="tail"
                testID="card-name-en"
              >
                {country.nameEn}
              </Text>
            </View>
          </View>
          {/* Sprint 4 design 1.1: can I enter, how safe is it, before the time and money. */}
          <CardSafety
            country={country}
            colorScheme={colorScheme}
            reduceMotion={reduceMotion}
            insetsBottom={bottomInset}
          />

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
                <Text style={[styles.sub, { color: palette.textSecondary }]}>
                  {isolateLtr(
                    country.currency.symbol === country.currency.code
                      ? country.currency.code
                      : `${isolateOwn(country.currency.symbol)} · ${country.currency.code}`,
                  )}
                </Text>
              </View>
            )}
          </View>
          {/* Sprint 4 design 1.1: the rate under the fields, then the temperature, then "Sources". */}
          <CardRateBlock
            country={country}
            colorScheme={colorScheme}
            reduceMotion={reduceMotion}
            insetsBottom={bottomInset}
          />
          <CardTemperature adm0={country.adm0} colorScheme={colorScheme} today={today} />
          <CardSources
            colorScheme={colorScheme}
            reduceMotion={reduceMotion}
            insetsBottom={bottomInset}
          />
        </View>

        <View style={styles.stub}>
          <SplitFlap
            text={country.adm0}
            reduceMotion={reduceMotion}
            dark={dark}
            accessibilityLabel={t('card.code', { code: country.adm0 })}
          />
          <Svg width={80} height={30} style={styles.barcode} importantForAccessibility="no">
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

      {coupon ? coupon(maxListHeight) : null}

      <Pressable
        onPress={onClose}
        style={styles.close}
        accessibilityRole="button"
        accessibilityLabel={t('card.close')}
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

/**
 * Wraps text in Unicode left-to-right isolates (LRI…PDI). Android ignores
 * writingDirection, so without this "฿ · THB" can be reordered inside the
 * Hebrew paragraph.
 */
export function isolateLtr(text: string): string {
  return `⁦${text}⁩`;
}

/**
 * Text in its own direction, taken from its first strong character: an Arabic
 * symbol inside the LTR line keeps its trailing period on the left (.د.ب).
 */
export function isolateOwn(text: string): string {
  return `⁨${text}⁩`;
}

function LocalTime({ country, colorScheme }: { country: CountryInfo; colorScheme: ColorScheme }) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const now = useMinuteClock();
  const timeZone = country.timeZone!;

  // A runtime that formats dates unexpectedly must hide the field, not crash
  // the screen (same rule as missing data, AC-4).
  let clock: string;
  let difference: string;
  try {
    clock = formatClock(zonedClock(timeZone, now));
    difference = timeDifferenceText(t, describeDifference(differenceFromIsrael(timeZone, now)));
  } catch (error) {
    console.warn(`[globe] could not compute local time for ${timeZone}`, error);
    return null;
  }

  return (
    <View testID="card-time">
      <Text style={[styles.label, { color: palette.textSecondary }]}>
        {country.city ? t('card.localTimeIn', { city: country.city }) : t('card.localTime')}
      </Text>
      <Text style={[styles.clock, { color: palette.textPrimary }]}>{isolateLtr(clock)}</Text>
      <Text style={[styles.sub, { color: palette.textSecondary }]} testID="card-time-difference">
        {difference}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    start: 12,
    end: 12,
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
  nameHeLong: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 },
  nameEnRow: { direction: 'ltr' },
  nameEnTight: { letterSpacing: 0 },
  nameEn: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 2,
    textTransform: 'uppercase',
    // Inside the LTR row, so these are physical sides: the reading start of the card.
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    writingDirection: 'ltr',
  },
  // At 130% font scale the currency drops to its own line rather than squeezing the time.
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 12 },
  clock: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 26, fontVariant: ['tabular-nums'] },
  value: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  sub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  // The close button sits at the end of the title row; long names wrap before it.
  clearOfClose: { paddingEnd: layout.touchTargetMin },
  barcode: { marginTop: 'auto' },
  close: {
    position: 'absolute',
    top: 6,
    end: STUB_WIDTH + 6,
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
