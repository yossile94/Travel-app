import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  findNodeHandle,
  I18nManager,
  Platform,
  Pressable,
  ScrollView,
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

import {
  CardEntryLine,
  CardSafetySheet,
  CardSources,
  useSafety,
} from '@/features/destination/CardDestination';
import { todayPg } from '@/features/trips/tripDates';
import { colors, fonts, highlightColor, layout, motion, type ColorScheme } from '@/theme/tokens';

import { boardingPassPath } from './boardingPassPath';
import { CardTiles } from './CardTiles';
import type { CountryInfo } from './countryData';
import { SplitFlap } from './SplitFlap';

const STUB_WIDTH = 108;
const NOTCH_RADIUS = 11;
const CORNER_RADIUS = 18;
const DECELERATE = Easing.bezier(0.05, 0.7, 0.1, 1);
const ACCELERATE = Easing.bezier(0.3, 0, 1, 1);
/** Space between the card and the bottom inset (Android navigation bar). */
export const CARD_GAP = 16;

/** The card's own scroll, for a coupon in scroll mode (sprint 4 design 1.3, Raz change 4). */
export const OuterScrollContext = createContext<OuterScroll | undefined>(undefined);

export interface OuterScroll {
  /** Grows each time the card's scroll comes within 48dp of its end. */
  nearEnd: number;
  /** Scrolls the card so a coupon row at `y` (from the coupon's top) starts 16dp from the top. */
  scrollToRow: (y: number) => void;
}

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
  /**
   * The coupon under the pass. In scroll mode (sprint 4 design 1.3) its list
   * doesn't scroll by itself: OuterScrollContext tells it when the card's
   * scroll nears the end (load more) and scrolls the card to a row.
   */
  coupon?: (maxListHeight: number, onNoticeHeight: (height: number) => void) => ReactNode;
  /** Today's local date, from the trips' shared "day changed" event (sprint 3 AC-6, AC-10). */
  today?: string;
  /** Sprint 9 AC-7: "why it matches", under the names, while discovery is on. */
  match?: ReactNode;
  /** Sprint 9 AC-12: a city chosen in search; its temperature and name replace the area's. */
  city?: { id: number; nameHe: string; nameEn: string } | null;
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
  match,
  city = null,
}: Props) {
  const { t } = useTranslation();
  const { fontScale, height: windowHeight } = useWindowDimensions();
  // The header (the names beside the stub): the first tear line (fix 3).
  const [passHeight, setPassHeight] = useState(0);
  // The tiles' strip under it; the coupon starts below both (Raz Q1).
  const [stripHeight, setStripHeight] = useState(0);
  const couponTop = passHeight + stripHeight;
  const measured = passHeight > 0 && stripHeight > 0;
  const safety = useSafety(country.adm0);
  const [safetyFrom, setSafetyFrom] = useState<'entry' | 'tile' | null>(null);
  const entryRef = useRef<ComponentRef<typeof Pressable>>(null);
  const safetyTileRef = useRef<ComponentRef<typeof Pressable>>(null);
  const closeSafety = () => {
    const from = safetyFrom;
    setSafetyFrom(null);
    // Focus goes back to whichever opened it (6).
    const node = findNodeHandle((from === 'entry' ? entryRef : safetyTileRef).current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  };
  // Design 1.2: the coupon's "shown from last save" line, when it shows, is part
  // of its fixed parts too (Raz, S4-M2).
  const [noticeHeight, setNoticeHeight] = useState(0);
  // Design 2.1: the whole card stays below insets.top + 112 + 48.
  const maxListHeight =
    windowHeight -
    (topInset + layout.overlayTop + layout.touchTargetMin) -
    (bottomInset + CARD_GAP) -
    couponTop -
    COUPON_CHROME -
    noticeHeight;
  const [nameEnWidth, setNameEnWidth] = useState(0);
  const palette = colors[colorScheme];
  const dark = colorScheme === 'dark';
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Sprint 4 design 1.3: with no room for even one trip row, the pass and the
  // coupon scroll together; the close button stays put.
  const maxCardHeight =
    windowHeight -
    (topInset + layout.overlayTop + layout.touchTargetMin) -
    (bottomInset + CARD_GAP);
  const scrollMode = coupon !== undefined && measured && maxListHeight < layout.tripRowMin;
  const [content, setContent] = useState({ width: 0, height: 0 });
  const outerRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [nearEnd, setNearEnd] = useState(0);
  const scrollToRow = useCallback(
    (y: number) =>
      outerRef.current?.scrollTo({ y: Math.max(0, couponTop + y - 16), animated: !reduceMotion }),
    [couponTop, reduceMotion],
  );
  const outer = useMemo<OuterScroll | undefined>(
    () => (scrollMode ? { nearEnd, scrollToRow } : undefined),
    [scrollMode, nearEnd, scrollToRow],
  );

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

  const notchX = I18nManager.isRTL ? STUB_WIDTH : content.width - STUB_WIDTH;

  return (
    <Animated.View
      style={[styles.card, { bottom: bottomInset + CARD_GAP }, enter]}
      onLayout={onLayout}
      pointerEvents={hidden ? 'none' : 'auto'}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={hidden}
      testID="country-card"
    >
      <ScrollView
        ref={outerRef}
        scrollEnabled={scrollMode}
        style={scrollMode ? { maxHeight: maxCardHeight } : undefined}
        onScroll={(event) => {
          if (!scrollMode) return;
          const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 48) {
            setNearEnd((n) => n + 1);
          }
        }}
        scrollEventThrottle={100}
        testID={scrollMode ? 'card-scroll-mode' : undefined}
      >
        <View onLayout={(event) => setContent(event.nativeEvent.layout)}>
          {content.width > 0 && (
            <Svg width={content.width} height={content.height} style={StyleSheet.absoluteFill}>
              <Path
                d={boardingPassPath(content.width, content.height, {
                  cornerRadius: CORNER_RADIUS,
                  notchX,
                  notchRadius: NOTCH_RADIUS,
                  tearYs: measured ? (coupon ? [passHeight, couponTop] : [passHeight]) : [],
                })}
                fill={palette.surfaceRaised}
                stroke={dark ? 'rgba(163,179,219,0.16)' : 'transparent'}
              />
              <Line
                x1={notchX}
                y1={NOTCH_RADIUS + 4}
                x2={notchX}
                y2={measured ? passHeight - 4 : content.height - NOTCH_RADIUS - 4}
                stroke={dark ? 'rgba(244,231,208,0.22)' : 'rgba(18,28,54,0.22)'}
                strokeWidth={2}
                strokeDasharray="6 5"
              />
              {(measured ? (coupon ? [passHeight, couponTop] : [passHeight]) : []).map((y) => (
                <Line
                  key={y}
                  x1={NOTCH_RADIUS + 4}
                  y1={y}
                  x2={content.width - NOTCH_RADIUS - 4}
                  y2={y}
                  stroke={dark ? 'rgba(244,231,208,0.22)' : 'rgba(18,28,54,0.22)'}
                  strokeWidth={2}
                  strokeDasharray="6 5"
                />
              ))}
            </Svg>
          )}

          <View
            style={styles.row}
            onLayout={(event) => setPassHeight(event.nativeEvent.layout.height)}
            testID="card-header"
          >
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
                      !spaceEnglishName(country.nameEn, fontScale, nameEnWidth) &&
                        styles.nameEnTight,
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
              {/* Fix 4.2: banned or restricted entry only; no threat level on the card (Yossi). */}
              <CardEntryLine
                ref={entryRef}
                country={country}
                advisory={safety.advisory}
                colorScheme={colorScheme}
                onOpen={() => setSafetyFrom('entry')}
              />
              {match}
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

          <View
            style={styles.tiles}
            onLayout={(event) => setStripHeight(event.nativeEvent.layout.height)}
            testID="card-strip"
          >
            <CardTiles
              country={country}
              safety={safety}
              colorScheme={colorScheme}
              reduceMotion={reduceMotion}
              insetsBottom={bottomInset}
              today={today}
              city={city}
              onOpenSafety={() => setSafetyFrom('tile')}
              safetyRef={safetyTileRef}
            />
            <CardSources
              colorScheme={colorScheme}
              reduceMotion={reduceMotion}
              insetsBottom={bottomInset}
            />
          </View>

          <OuterScrollContext.Provider value={outer}>
            {coupon ? coupon(scrollMode ? Infinity : maxListHeight, setNoticeHeight) : null}
          </OuterScrollContext.Provider>
        </View>
      </ScrollView>

      <CardSafetySheet
        country={country}
        safety={safety}
        visible={safetyFrom !== null}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={bottomInset}
        onClose={closeSafety}
      />

      <Pressable
        onPress={onClose}
        style={styles.close}
        accessibilityRole="button"
        accessibilityLabel={t('card.close')}
        testID="card-close"
      >
        {/* In scroll mode the content passes under the button: a round
            surface keeps the × readable (design 1.3, QA S4 #2). */}
        {scrollMode ? (
          <View
            testID="card-close-backdrop"
            style={[styles.closeBackdrop, { backgroundColor: palette.surfaceRaised }]}
          />
        ) : null}
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
  // Fix 5.3: full width under the header, its own tear line above it.
  tiles: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
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
  closeBackdrop: { position: 'absolute', width: 40, height: 40, borderRadius: 20 },
});
