/**
 * Country search over the globe (sprint 1 F-002; design docs/design/sprint-01
 * section 2): a magnifier button that opens a full-width field, with results
 * that behave exactly like a tap on the globe.
 */
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  BackHandler,
  Dimensions,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ChromeButton } from '@/components/ChromeButton';
import { BackIcon, ClearIcon, SearchIcon } from '@/components/icons';
import { colors, fonts, globe, layout, motion, radius, type ColorScheme } from '@/theme/tokens';

import { isolateLtr } from '../globe/BoardingPassCard';
import { logSearchResults } from '../globe/perfLog';
import { countryByAdm0 } from '../globe/countryData';
import { useDestination, type EntryStatus } from '../destination/destinationData';
import { EntryTag } from '../destination/DestinationFields';
import { globalCityIndex, searchAllCities, type GlobalCity } from '../trips/citiesData';
import { searchCountries, type SearchEntry } from './search';

/** A row of the results: a country, or a city that leads to its country (sprint 4 F-014). */
type Row =
  | { kind: 'country'; entry: SearchEntry }
  | { kind: 'city'; city: GlobalCity }
  | { kind: 'header'; label: 'countries' | 'cities' }
  | { kind: 'loading' };

interface Props {
  open: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
  onOpen: () => void;
  /** Closed without choosing a country. */
  onClose: () => void;
  /** A country, or a city with its country (sprint 9 AC-12: the camera flies to the city). */
  onSelect: (adm0: string, city?: SearchCity) => void;
}

export interface SearchCity {
  id: number;
  nameHe: string;
  nameEn: string;
}

/** Results start 8dp below the 48dp field row. */
const RESULTS_OFFSET = layout.chromeRowTop + layout.touchTargetMin + 8;

const STANDARD = Easing.bezier(0.2, 0, 0, 1);
const DECELERATE = Easing.bezier(0.05, 0.7, 0.1, 1);

export function SearchBar({
  open,
  colorScheme,
  reduceMotion,
  insetsTop,
  insetsBottom,
  onOpen,
  onClose,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const { results, more } = useMemo(() => searchCountries(query), [query]);
  // Cities join when the city list is loaded; countries never wait for it (AC-11).
  const [cities, setCities] = useState<{ query: string; list: GlobalCity[] }>({
    query: '',
    list: [],
  });
  // The index is built when search opens, not at globe-ready (design 9.2).
  useEffect(() => {
    if (open) void globalCityIndex().catch(() => {});
  }, [open]);
  const wantsCities = query.trim().length >= 2;
  const citiesReady = cities.query === query;
  // "טוענים ערים…" only after 150 ms, so it never flashes (design 9.2).
  const [slowQuery, setSlowQuery] = useState('');
  useEffect(() => {
    if (!wantsCities || citiesReady) return;
    const timer = setTimeout(() => setSlowQuery(query), 150);
    return () => clearTimeout(timer);
  }, [query, wantsCities, citiesReady]);
  useEffect(() => {
    if (!wantsCities) return;
    let live = true;
    searchAllCities(query, 5).then(
      (list) => live && setCities({ query, list }),
      // No city list: countries only, and the search counts as done.
      () => live && setCities({ query, list: [] }),
    );
    return () => {
      live = false;
    };
  }, [query, wantsCities]);
  const cityList = useMemo(() => (cities.query === query ? cities.list : []), [cities, query]);
  const rows = useMemo<Row[]>(() => {
    const both = results.length > 0 && cityList.length > 0;
    const list: Row[] = [];
    // Group headings only when both groups show (design 9.1).
    if (both) list.push({ kind: 'header', label: 'countries' });
    list.push(...results.map((entry): Row => ({ kind: 'country', entry })));
    if (both) list.push({ kind: 'header', label: 'cities' });
    list.push(...cityList.map((city): Row => ({ kind: 'city', city })));
    // Also with no country match: an empty panel would look like no results (Raz, S4-m13).
    if (wantsCities && !citiesReady && slowQuery === query) {
      list.push({ kind: 'loading' });
    }
    return list;
  }, [results, cityList, wantsCities, citiesReady, slowQuery, query]);
  const destination = useDestination();
  const entryOf = (adm0: string) => destination.data?.advisories.get(adm0)?.entryStatus ?? null;

  // The field stays on screen while it folds back into the button (design 2.4).
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(!open);
  }
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), motion.medium);
    return () => clearTimeout(timer);
  }, [closing]);

  // Design 2.4: the button widens into the field and the globe dims. With
  // reduced motion it is a crossfade with no change of width. The reduced
  // version must still run, so it opts out of Reanimated's system default.
  const progress = useSharedValue(0);
  const scrim = useSharedValue(0);
  const resultsIn = useSharedValue(0);
  useEffect(() => {
    progress.set(
      withTiming(open ? 1 : 0, {
        duration: reduceMotion ? motion.short : motion.medium,
        easing: reduceMotion ? Easing.linear : STANDARD,
        reduceMotion: ReduceMotion.Never,
      }),
    );
    scrim.set(
      withTiming(open ? 1 : 0, {
        duration: motion.short,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.Never,
      }),
    );
    if (!open) resultsIn.set(0);
  }, [open, reduceMotion, progress, scrim, resultsIn]);

  const hasQuery = query.length > 0;
  useEffect(() => {
    if (!hasQuery) {
      resultsIn.set(0);
      return;
    }
    // The first results of an opening slide in once; later keystrokes swap them instantly (AC-1).
    resultsIn.set(
      withTiming(1, {
        duration: 150,
        easing: DECELERATE,
        reduceMotion: ReduceMotion.Never,
      }),
    );
  }, [hasQuery, resultsIn]);

  const screenWidth = Dimensions.get('screen').width;
  const collapsedEnd = screenWidth - layout.chromeEdge - layout.touchTargetMin;
  const fieldStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: progress.value, end: layout.chromeEdge }
      : {
          opacity: Math.min(1, progress.value * 3),
          end: layout.chromeEdge + (1 - progress.value) * (collapsedEnd - layout.chromeEdge),
        },
  );
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const resultsStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: resultsIn.value }
      : { opacity: resultsIn.value, transform: [{ translateY: (resultsIn.value - 1) * 8 }] },
  );

  // AC-1: from the keystroke to the frame that shows its results.
  const typedAt = useRef(0);
  const latestQuery = useRef(query);
  useEffect(() => {
    latestQuery.current = query;
    if (!query || !typedAt.current) return;
    const startedAt = typedAt.current;
    const frame = requestAnimationFrame(() => {
      if (latestQuery.current === query) logSearchResults(query, performance.now() - startedAt);
    });
    return () => cancelAnimationFrame(frame);
  }, [query]);

  const onChangeText = useCallback((text: string) => {
    typedAt.current = performance.now();
    setQuery(text);
  }, []);

  const clear = useCallback(() => {
    setQuery('');
    // The clear button disappears with the text, so focus goes back to the
    // field: keyboard focus at once, and the screen reader's focus once the
    // button is gone (focus() alone leaves TalkBack on a vanished element).
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      if (inputRef.current) AccessibilityInfo.sendAccessibilityEvent(inputRef.current, 'focus');
    });
  }, []);

  const close = useCallback(() => {
    Keyboard.dismiss();
    setQuery('');
    onClose();
  }, [onClose]);

  const select = useCallback(
    (entry: { adm0: string } | GlobalCity) => {
      Keyboard.dismiss();
      setQuery('');
      onSelect(
        entry.adm0,
        'id' in entry ? { id: entry.id, nameHe: entry.nameHe, nameEn: entry.nameEn } : undefined,
      );
    },
    [onSelect],
  );

  // AC-4: Android back closes search. With the keyboard up, Android closes the
  // keyboard first and that press never reaches JS, so it takes "back, back".
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [open, close]);

  // A tap on the scrim keeps typed text: first it hides the keyboard, then it closes.
  const [keyboardShown, setKeyboardShown] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardShown(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardShown(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const onScrimPress = useCallback(() => {
    if (query && keyboardShown) Keyboard.dismiss();
    else close();
  }, [query, keyboardShown, close]);

  const announcement = useAnnouncement(query, results.length, more, cityList.length);

  // The results end 8dp above the keyboard, or 16dp above the navigation bar.
  // The window doesn't resize for the keyboard (design 2.6), so this is computed.
  const keyboard = useAnimatedKeyboard();
  const screenHeight = Dimensions.get('screen').height;
  const top = insetsTop + RESULTS_OFFSET;
  const listMaxHeight = useAnimatedStyle(() => {
    const bottomGap = keyboard.height.value > 0 ? keyboard.height.value + 8 : insetsBottom + 16;
    return { maxHeight: Math.max(layout.listRowMin, screenHeight - top - bottomGap) };
  });

  if (!open && !closing) {
    return (
      <ChromeButton
        colorScheme={colorScheme}
        accessibilityLabel={t('search.open')}
        onPress={onOpen}
        style={[styles.openButton, { top: insetsTop + layout.chromeRowTop }]}
        testID="search-open"
      >
        <SearchIcon color={palette.chromeFg} />
      </ChromeButton>
    );
  }

  const surface = {
    backgroundColor: palette.surfaceRaised,
    borderColor: palette.borderSubtle,
    borderWidth: colorScheme === 'dark' ? 1 : 0,
    elevation: colorScheme === 'dark' ? 0 : 3,
  };

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={open ? 'box-none' : 'none'}
      testID={open ? 'search-panel' : 'search-panel-closing'}
    >
      <Animated.View style={[styles.scrim, { top }, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onScrimPress}
          accessible={false}
          importantForAccessibility="no"
          testID="search-scrim"
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.field,
          surface,
          { top: insetsTop + layout.chromeRowTop },
          // Design 2.1: the focus ring replaces the outline only while the field has focus.
          focused && { borderColor: palette.focusRing, borderWidth: 2 },
          fieldStyle,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('search.close')}
          onPress={close}
          style={styles.iconButton}
          testID="search-close"
        >
          <BackIcon color={palette.textPrimary} />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => {
            // The first in the list: a country, or a city when no country matched (sprint 4 design 9.1).
            const first = results[0] ?? cityList[0];
            if (first) select(first);
          }}
          // Design 2.3: with no results the search key does nothing, keyboard included.
          submitBehavior={results[0] || cityList[0] ? 'blurAndSubmit' : 'submit'}
          placeholder={t('search.placeholder')}
          placeholderTextColor={palette.textTertiary}
          accessibilityLabel={t('search.placeholder')}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          importantForAutofill="no"
          returnKeyType="search"
          maxFontSizeMultiplier={2}
          style={[styles.input, { color: palette.textPrimary }]}
          testID="search-input"
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('search.clear')}
            onPress={clear}
            style={styles.iconButton}
            testID="search-clear"
          >
            <ClearIcon color={palette.textSecondary} />
          </Pressable>
        ) : null}
      </Animated.View>

      {query ? (
        <Animated.View style={[styles.results, surface, { top }, listMaxHeight, resultsStyle]}>
          {rows.length === 0 && !(wantsCities && !citiesReady) ? (
            <View style={styles.empty} testID="search-empty">
              <Text style={[styles.name, { color: palette.textPrimary }]}>
                {t('search.noResults')}
              </Text>
              <Text style={[styles.secondary, { color: palette.textSecondary }]}>
                {t('search.noResultsHint')}
              </Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(row) =>
                row.kind === 'country'
                  ? row.entry.adm0
                  : row.kind === 'city'
                    ? `city-${row.city.id}`
                    : row.kind === 'header'
                      ? `header-${row.label}`
                      : 'loading'
              }
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: palette.borderSubtle }]} />
              )}
              renderItem={({ item }) =>
                item.kind === 'country' ? (
                  <ResultRow
                    entry={item.entry}
                    entry2={entryOf(item.entry.adm0)}
                    colorScheme={colorScheme}
                    onPress={select}
                  />
                ) : item.kind === 'city' ? (
                  <CityRow
                    city={item.city}
                    entry={entryOf(item.city.adm0)}
                    colorScheme={colorScheme}
                    onPress={select}
                  />
                ) : item.kind === 'header' ? (
                  <Text
                    accessibilityRole="header"
                    style={[styles.groupHeader, { color: palette.textTertiary }]}
                  >
                    {t(item.label === 'countries' ? 'search.groupCountries' : 'search.groupCities')}
                  </Text>
                ) : (
                  <View style={styles.loadingRow} testID="search-cities-loading">
                    <ActivityIndicator size={16} color={palette.textSecondary} />
                    <Text style={[styles.secondary, { color: palette.textSecondary }]}>
                      {t('search.citiesLoading')}
                    </Text>
                  </View>
                )
              }
              ListFooterComponent={
                more ? (
                  <Text style={[styles.more, { color: palette.textTertiary }]}>
                    {t('search.more')}
                  </Text>
                ) : undefined
              }
            />
          )}
        </Animated.View>
      ) : null}

      {/* AC-6: the result count, read once typing pauses. */}
      <Text accessibilityLiveRegion="polite" style={styles.visuallyHidden}>
        {announcement}
      </Text>
    </View>
  );
}

function ResultRow({
  entry,
  entry2,
  colorScheme,
  onPress,
}: {
  entry: SearchEntry;
  /** The country's entry status (sprint 4 design 5.2). */
  entry2: EntryStatus | null;
  colorScheme: ColorScheme;
  onPress: (entry: SearchEntry) => void;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const base = entry.parentHe
    ? t('search.rowTerritory', { name: entry.nameHe, parent: entry.parentHe, nameEn: entry.nameEn })
    : t('search.row', { name: entry.nameHe, nameEn: entry.nameEn });
  const label = entryWords(base, entry2, t);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onPress(entry)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.pressed }]}
      testID={`search-result-${entry.adm0}`}
    >
      <View style={styles.rowText}>
        <Text style={[styles.name, { color: palette.textPrimary }]}>
          {entry.nameHe}
          {entry.parentHe ? (
            <Text style={[styles.parent, { color: palette.textSecondary }]}>
              {` (${entry.parentHe})`}
            </Text>
          ) : null}
        </Text>
        <Text style={[styles.secondary, { color: palette.textSecondary }]}>
          {isolateLtr(entry.nameEn)}
        </Text>
      </View>
      <EntryTag status={entry2} colorScheme={colorScheme} />
      <View
        style={[styles.tag, { backgroundColor: palette.tag }]}
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.tagText, { color: palette.textSecondary }]}>{entry.adm0}</Text>
      </View>
    </Pressable>
  );
}

/** The row's label with the entry status in words (design 5.3). */
function entryWords(label: string, entry: EntryStatus | null, t: TFunction): string {
  if (entry === 'banned') return `${label}, ${t('entry.bannedA11y')}`;
  if (entry === 'restricted') return `${label}, ${t('entry.restrictedA11y')}`;
  return label;
}

/**
 * "בנגקוק, תאילנד" with "Bangkok" under it; in English one line, "Bangkok,
 * Thailand". A city leads to its country's card (sprint 4 design 9.1).
 */
function CityRow({
  city,
  entry,
  colorScheme,
  onPress,
}: {
  city: GlobalCity;
  entry: EntryStatus | null;
  colorScheme: ColorScheme;
  onPress: (entry: GlobalCity) => void;
}) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];
  const country = countryByAdm0(city.adm0);
  const hebrew = i18n.language === 'he';
  const countryName = hebrew ? (country?.nameHe ?? city.adm0) : (country?.nameEn ?? city.adm0);
  const cityName = hebrew && city.nameHe ? city.nameHe : isolateLtr(city.nameEn);
  const label = entryWords(
    hebrew
      ? t('search.cityA11y', {
          city: city.nameHe || city.nameEn,
          country: countryName,
          cityEn: city.nameEn,
        })
      : t('search.cityA11y', { city: city.nameEn, country: countryName }),
    entry,
    t,
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('search.cityHint', { country: countryName })}
      onPress={() => onPress(city)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.pressed }]}
      testID={`search-city-${city.id}`}
    >
      <View style={styles.rowText}>
        <Text style={[styles.name, { color: palette.textPrimary }]}>
          {cityName}
          <Text
            style={[styles.parent, { color: palette.textSecondary }]}
          >{`, ${countryName}`}</Text>
        </Text>
        {hebrew && city.nameHe ? (
          <Text style={[styles.secondary, { color: palette.textSecondary }]}>
            {isolateLtr(city.nameEn)}
          </Text>
        ) : null}
      </View>
      <EntryTag status={entry} colorScheme={colorScheme} />
      <View
        style={[styles.tag, { backgroundColor: palette.tag }]}
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.tagText, { color: palette.textSecondary }]}>{city.adm0}</Text>
      </View>
    </Pressable>
  );
}

/**
 * The live-region text: set only after typing pauses, and cleared as soon as
 * the field is, so a new search never starts by reading out the old count.
 */
function useAnnouncement(query: string, count: number, more: boolean, cityCount = 0) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  if (!query && text) setText('');
  useEffect(() => {
    if (!query) return;
    const timer = setTimeout(() => {
      // With cities: "נמצאו: 2 מדינות, 5 ערים" (design 9.4).
      if (cityCount > 0) {
        const parts = [
          count === 0
            ? null
            : count === 1
              ? t('search.nCountryOne')
              : t('search.nCountryMany', { n: count }),
          cityCount === 1 ? t('search.nCityOne') : t('search.nCityMany', { n: cityCount }),
        ].filter(Boolean);
        setText(t('search.countFound', { parts: parts.join(', ') }));
        return;
      }
      setText(
        count === 0
          ? t('search.countNone')
          : more
            ? t('search.countMore', { count })
            : count === 1
              ? t('search.countOne')
              : t('search.countMany', { count }),
      );
    }, motion.searchAnnounceDelay);
    return () => clearTimeout(timer);
  }, [query, count, more, cityCount, t]);
  return query ? text : '';
}

const styles = StyleSheet.create({
  groupHeader: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    paddingTop: 12,
    paddingBottom: 4,
    paddingHorizontal: 16,
    textAlign: 'left',
  },
  loadingRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  openButton: { position: 'absolute', start: layout.chromeEdge },
  scrim: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    backgroundColor: globe.searchScrim,
  },
  field: {
    position: 'absolute',
    start: layout.chromeEdge,
    minHeight: layout.touchTargetMin,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  iconButton: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: layout.touchTargetMin,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    paddingVertical: 0,
    // Unlike Text, Android's EditText takes textAlign literally (seen on the
    // A73: 'left' put Hebrew on the left), so the start edge in Hebrew is
    // 'right'; it also keeps Latin input ("usa") on the right (design 2.5).
    textAlign: 'right',
  },
  results: {
    position: 'absolute',
    start: layout.chromeEdge,
    end: layout.chromeEdge,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  row: {
    minHeight: layout.listRowMin,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: { flex: 1 },
  name: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  parent: { fontFamily: fonts.regular },
  secondary: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  tag: { borderRadius: radius.xs, paddingHorizontal: 6, paddingVertical: 2 },
  tagText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
    fontVariant: ['tabular-nums'],
  },
  separator: { height: 1, marginStart: 16 },
  more: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingTop: 11,
    textAlign: 'left',
  },
  empty: { padding: 16, gap: 4 },
  visuallyHidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
