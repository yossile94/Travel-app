/**
 * The discovery results (sprint 9 AC-6, AC-8, design 8): a plain view over
 * the globe, not a modal, so the coloured globe stays in sight. Open or
 * collapsed; hidden (never unmounted) while a card is open, so it comes back
 * at the same scroll place (Raz).
 */
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { CloudOffIcon } from '@/components/icons';
import { countryByAdm0 } from '@/features/globe/countryData';
import { colors, fonts, layout, motion, radius, type ColorScheme } from '@/theme/tokens';

import type { DiscoverFilters, DiscoverResult } from './discover';
import {
  citiesLine,
  countText,
  countriesText,
  formatFlightHours,
  numericDate,
  reasonTexts,
} from './discoverText';

const DECELERATE = Easing.bezier(0.05, 0.7, 0.1, 1);

export type PanelState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'chooseType' }
  | { kind: 'results'; results: readonly DiscoverResult[] };

export interface WithoutOption {
  chip: 'family' | 'weather' | 'near';
  label: string;
  count: number;
}

interface Props {
  state: PanelState;
  filters: DiscoverFilters;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  /** A card is open: out of sight and out of reach, still mounted. */
  hidden: boolean;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
  /** Offline with "family": the advisories copy's date (design 11.1). */
  advisoriesAsOf: string | null;
  without: readonly WithoutOption[];
  onWithout: (chip: WithoutOption['chip']) => void;
  onClear: () => void;
  onRetry: () => void;
  onRow: (adm0: string) => void;
  /** The row a closed card returns focus to (design 12.3). */
  refocus: { adm0: string; seq: number } | null;
  /** The panel's height on screen, for the camera's bottom padding (design 8.9). */
  onHeight: (height: number) => void;
}

export function DiscoverPanel({
  state,
  filters,
  colorScheme,
  reduceMotion,
  insetsBottom,
  hidden,
  collapsed,
  onCollapsed,
  advisoriesAsOf,
  without,
  onWithout,
  onClear,
  onRetry,
  onRow,
  refocus,
  onHeight,
}: Props) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];
  const { height: windowHeight } = useWindowDimensions();
  const results = state.kind === 'results' ? state.results : null;

  // Design 14: up from below in 320 ms; with reduced motion, a 200 ms fade.
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.set(
      withTiming(1, {
        duration: reduceMotion ? motion.short : motion.discoverPanelEnter,
        easing: DECELERATE,
        reduceMotion: ReduceMotion.Never,
      }),
    );
  }, [enter, reduceMotion]);
  const enterStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: enter.get() }
      : { transform: [{ translateY: (1 - enter.get()) * windowHeight * 0.5 }] },
  );

  // Design 8.10: pages of 50; a new result starts at the top with one page.
  const [paging, setPaging] = useState({ results, pages: 1 });
  if (paging.results !== results) setPaging({ results, pages: 1 });
  const listRef = useRef<FlatList<DiscoverResult>>(null);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [results]);

  const rows = useRef(new Map<string, ComponentRef<typeof Pressable>>());
  useEffect(() => {
    if (!refocus) return;
    const timer = setTimeout(() => {
      const node = rows.current.get(refocus.adm0);
      const handle = node ? findNodeHandle(node) : null;
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    }, motion.discoverPanelEnter);
    return () => clearTimeout(timer);
  }, [refocus]);

  const title =
    state.kind === 'loading'
      ? t('discover.loading')
      : state.kind === 'error'
        ? t('discover.climateError')
        : state.kind === 'chooseType'
          ? t('discover.chooseType')
          : countText(state.results.length, t);
  const swatch = state.kind === 'results' && state.results.length > 0;

  const header = (
    <View>
      <View style={styles.titleRow}>
        <Pressable
          style={styles.titlePress}
          onPress={() => onCollapsed(!collapsed)}
          accessibilityRole="header"
          testID="discover-count"
        >
          {swatch ? (
            <View
              style={[styles.swatch, { backgroundColor: palette.discoverSwatch }]}
              importantForAccessibility="no"
            />
          ) : null}
          <Text style={[styles.title, { color: palette.textPrimary }]}>{title}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityHint={t('discover.clearHint')}
          hitSlop={8}
          onPress={onClear}
          style={styles.clear}
          testID="discover-clear"
        >
          <Text style={[styles.clearText, { color: palette.link }]}>{t('discover.clear')}</Text>
        </Pressable>
      </View>
      {advisoriesAsOf && filters.family ? (
        <View style={styles.note} testID="discover-advisories-as-of">
          <CloudOffIcon color={palette.textSecondary} size={16} />
          <Text style={[styles.footnote, { color: palette.textSecondary }]}>
            {t('discover.advisoriesAsOf', { date: numericDate(advisoriesAsOf) })}
          </Text>
        </View>
      ) : null}
      {filters.weather === 'winter' && state.kind === 'results' ? (
        <Text
          style={[styles.footnote, styles.noteText, { color: palette.textSecondary }]}
          testID="discover-winter-note"
        >
          {t('discover.winterNote')}
        </Text>
      ) : null}
    </View>
  );

  const disclaimer = (
    <Text
      style={[styles.footnote, styles.disclaimer, { color: palette.textSecondary }]}
      testID="discover-disclaimer"
    >
      {t('discover.disclaimer')}
    </Text>
  );

  let body;
  if (state.kind === 'loading') {
    body = <View testID="discover-loading" style={styles.empty} />;
  } else if (state.kind === 'error') {
    body = (
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={styles.retry}
        testID="discover-retry"
      >
        <Text style={[styles.clearText, { color: palette.link }]} testID="discover-climate-error">
          {t('discover.retry')}
        </Text>
      </Pressable>
    );
  } else if (state.kind === 'chooseType') {
    body = (
      <Text
        style={[styles.body, styles.empty, { color: palette.textSecondary }]}
        testID="discover-choose-type"
      >
        {t('discover.chooseTypeBody')}
      </Text>
    );
  } else if (state.results.length === 0) {
    body = (
      <View style={styles.empty} testID="discover-empty">
        <Text style={[styles.body, { color: palette.textSecondary }]}>
          {t('discover.emptyHint')}
        </Text>
        {without.map((w) => (
          <Pressable
            key={w.chip}
            accessibilityRole="button"
            onPress={() => onWithout(w.chip)}
            style={({ pressed }) => [
              styles.without,
              { backgroundColor: pressed ? palette.pressed : palette.secondaryBg },
            ]}
            testID={`discover-without-${w.chip}`}
          >
            <Text style={[styles.withoutText, { color: palette.secondaryFg }]}>
              {t('discover.without', { chip: w.label, count: countriesText(w.count, t) })}
            </Text>
          </Pressable>
        ))}
        {disclaimer}
      </View>
    );
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={state.results.slice(0, layout.discoverPageSize * paging.pages)}
        keyExtractor={(r) => r.adm0}
        initialNumToRender={12}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (paging.pages * layout.discoverPageSize < state.results.length)
            setPaging((p) => ({ ...p, pages: p.pages + 1 }));
        }}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: palette.borderSubtle }]} />
        )}
        renderItem={({ item }) => (
          <DiscoverRow
            result={item}
            filters={filters}
            colorScheme={colorScheme}
            language={i18n.language}
            onPress={onRow}
            rowRef={(node) => {
              if (node) rows.current.set(item.adm0, node);
              else rows.current.delete(item.adm0);
            }}
          />
        )}
        ListFooterComponent={disclaimer}
        testID="discover-list"
      />
    );
  }

  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={hidden}
      style={[
        styles.panel,
        enterStyle,
        {
          backgroundColor: palette.surfaceRaised,
          borderTopColor: palette.borderSubtle,
          borderTopWidth: colorScheme === 'dark' ? 1 : 0,
          paddingBottom: insetsBottom,
          maxHeight: collapsed
            ? layout.discoverPanelPeek + insetsBottom
            : windowHeight * layout.discoverPanelMaxRatio,
          opacity: hidden ? 0 : 1,
        },
      ]}
      onLayout={(e: LayoutChangeEvent) => onHeight(e.nativeEvent.layout.height)}
      testID="discover-panel"
      accessibilityValue={{ text: collapsed ? 'collapsed' : 'open' }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={collapsed ? t('discover.panelShow') : t('discover.panelHide')}
        accessibilityState={{ expanded: !collapsed }}
        hitSlop={{ top: 12, bottom: 8, left: 24, right: 24 }}
        onPress={() => onCollapsed(!collapsed)}
        style={styles.handleHit}
        testID="discover-panel-handle"
      >
        <View style={[styles.handle, { backgroundColor: palette.borderControl }]} />
      </Pressable>
      {header}
      {collapsed ? null : body}
    </Animated.View>
  );
}

function DiscoverRow({
  result,
  filters,
  colorScheme,
  language,
  onPress,
  rowRef,
}: {
  result: DiscoverResult;
  filters: DiscoverFilters;
  colorScheme: ColorScheme;
  language: string;
  onPress: (adm0: string) => void;
  rowRef: (node: ComponentRef<typeof Pressable> | null) => void;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const country = countryByAdm0(result.adm0);
  const name =
    language === 'he' ? (country?.nameHe ?? result.adm0) : (country?.nameEn ?? result.adm0);
  const reasons = reasonTexts(result, filters, t, language);
  const hours = formatFlightHours(result.reasons.hours, t);
  const cities = citiesLine(result.cities, t, language);
  const label = [
    name,
    ...reasons.map((r) => r.a11y),
    ...(cities ? [cities] : []),
    t('discover.hoursFlight', { hours }),
  ].join(', ');
  return (
    <Pressable
      ref={rowRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('discover.rowHint')}
      onPress={() => onPress(result.adm0)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.pressed }]}
      testID={`discover-row-${result.adm0}`}
    >
      <View
        style={[styles.swatch, styles.rowSwatch, { backgroundColor: palette.discoverSwatch }]}
        importantForAccessibility="no"
      />
      <View style={styles.rowText}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, { color: palette.textPrimary }]} numberOfLines={2}>
            {name}
          </Text>
          <Text
            style={[styles.hours, { color: palette.textSecondary }]}
            testID={`discover-row-${result.adm0}-hours`}
          >
            {hours}
          </Text>
        </View>
        {reasons.length ? (
          <Text
            style={[styles.footnote, { color: palette.textSecondary }]}
            testID={`discover-row-${result.adm0}-reasons`}
          >
            {reasons.map((r) => r.text).join(' · ')}
          </Text>
        ) : null}
        {cities ? (
          <Text
            style={[styles.footnote, { color: palette.textSecondary }]}
            testID={`discover-row-${result.adm0}-cities`}
          >
            {cities}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    borderTopStartRadius: radius.sheet,
    borderTopEndRadius: radius.sheet,
    overflow: 'hidden',
  },
  handleHit: {
    alignSelf: 'center',
    width: 48,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: { width: 32, height: 4, borderRadius: 2 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 48,
  },
  titlePress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 20,
    lineHeight: 25,
    flexShrink: 1,
    textAlign: 'left',
  },
  swatch: { width: layout.discoverSwatch, height: layout.discoverSwatch, borderRadius: 5 },
  rowSwatch: { marginTop: 7 },
  clear: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  noteText: { paddingHorizontal: 16, paddingBottom: 6 },
  footnote: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'left',
    flexShrink: 1,
  },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  disclaimer: { padding: 16 },
  empty: { paddingHorizontal: 16, paddingBottom: 8, gap: 8, minHeight: 64 },
  retry: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, marginBottom: 8 },
  without: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  withoutText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  separator: { height: 1, marginStart: 16 },
  row: {
    flexDirection: 'row',
    gap: 10,
    minHeight: layout.discoverRowMin,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  rowText: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  name: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  hours: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, fontVariant: ['tabular-nums'] },
});
