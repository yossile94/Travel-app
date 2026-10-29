/**
 * Sprint 3 F-008 (AC-4): "Cities" in the trip form (design 5.1) and the
 * "Add a city" screen pushed over it (5.2–5.4). Order is the order added,
 * the same city may appear twice, up to 10; a place not in the list can be
 * added as written (no climate). Works offline: the list ships in the app.
 */
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  I18nManager,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  findNodeHandle,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';

import { InlineNotice } from '@/components/formControls';
import { BackIcon, MinusCircleIcon, PlusIcon, SearchIcon } from '@/components/icons';
import type { CountryInfo } from '@/features/globe/countryData';
import { isolateOwn } from '@/features/globe/BoardingPassCard';
import { colors, fonts, layout, motion, radius, type ColorScheme } from '@/theme/tokens';

import { cityIndex } from './citiesData';
import { displayName, hasExactMatch, searchCities, type CityEntry } from './citySearch';
import { countryName } from './countryName';
import { codePointLength } from './tripDates';
import { cleanTypedName } from './tripFormRules';
import type { TripCity } from './tripsApi';

export const MAX_CITIES = 10;
const NAME_MAX = 60;

interface Props {
  country: CountryInfo;
  cities: TripCity[];
  onChange: (cities: TripCity[]) => void;
  disabled: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
}

export function CitiesSection({
  country,
  cities,
  onChange,
  disabled,
  colorScheme,
  reduceMotion,
  insetsTop,
  insetsBottom,
}: Props) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const [searching, setSearching] = useState(false);
  const addButton = useRef<ComponentRef<typeof Pressable>>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(focusTimer.current), []);
  const removeButtons = useRef<(ComponentRef<typeof Pressable> | null)[]>([]);
  const focusAfterRemove = useRef<number | null>(null);
  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    const target = (index >= 0 ? removeButtons.current[index] : null) ?? addButton.current;
    const node = findNodeHandle(target);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [cities]);

  const remove = (index: number) => {
    const name = cities[index]!.name;
    onChange(cities.filter((_, i) => i !== index));
    AccessibilityInfo.announceForAccessibility(t('tripForm.cityRemoved', { city: name }));
    focusAfterRemove.current = Math.min(index, cities.length - 2);
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={[styles.caption, { color: palette.textSecondary }]} accessibilityRole="header">
          {t('tripForm.cities')}
        </Text>
        <Text style={[styles.caption, { color: palette.textTertiary }]}>
          {t('tripForm.citiesHint')}
        </Text>
      </View>
      <View
        style={[
          styles.card,
          {
            backgroundColor: palette.surface,
            borderColor: colorScheme === 'dark' ? palette.borderSubtle : 'transparent',
          },
        ]}
      >
        {cities.map((city, index) => (
          <View
            key={`${index}-${city.name}`}
            style={[
              styles.row,
              index > 0 && styles.divider,
              { borderTopColor: palette.borderSubtle },
            ]}
          >
            <View
              style={styles.rowMain}
              accessible
              accessibilityLabel={
                t('tripForm.cityRowA11y', { n: index + 1, total: cities.length, city: city.name }) +
                (city.geonameId === null ? `, ${t('tripForm.cityFree')}` : '')
              }
            >
              <Text
                style={[
                  styles.number,
                  { backgroundColor: palette.tag, color: palette.textSecondary },
                ]}
              >
                {index + 1}
              </Text>
              <View style={styles.grow}>
                <Text style={[styles.body, { color: palette.textPrimary }]} numberOfLines={2}>
                  {isolateOwn(city.name)}
                </Text>
                {city.geonameId === null ? (
                  <Text style={[styles.caption, { color: palette.textTertiary }]}>
                    {t('tripForm.cityFree')}
                  </Text>
                ) : null}
              </View>
            </View>
            <Pressable
              ref={(node) => {
                removeButtons.current[index] = node;
              }}
              accessibilityRole="button"
              accessibilityLabel={t('tripForm.cityRemove', { city: city.name })}
              disabled={disabled}
              onPress={() => remove(index)}
              style={styles.iconButton}
              testID={`city-remove-${index}`}
            >
              <MinusCircleIcon color={palette.textSecondary} />
            </Pressable>
          </View>
        ))}
        <View
          style={
            cities.length > 0
              ? [styles.divider, { borderTopColor: palette.borderSubtle }]
              : undefined
          }
        >
          {cities.length >= MAX_CITIES ? (
            <Text style={[styles.footnote, styles.limit, { color: palette.textSecondary }]}>
              {t('tripForm.citiesMax')}
            </Text>
          ) : (
            <Pressable
              ref={addButton}
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => setSearching(true)}
              style={({ pressed }) => [styles.add, pressed && { backgroundColor: palette.pressed }]}
              testID="city-add"
            >
              <PlusIcon color={palette.link} size={20} />
              <Text style={[styles.bodyStrong, { color: palette.link }]}>
                {t('tripForm.addCity')}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {searching ? (
        <CitySearchScreen
          country={country}
          colorScheme={colorScheme}
          reduceMotion={reduceMotion}
          insetsTop={insetsTop}
          insetsBottom={insetsBottom}
          onClose={() => setSearching(false)}
          onPick={(city) => {
            setSearching(false);
            onChange([...cities, city]);
            AccessibilityInfo.announceForAccessibility(
              t('tripForm.cityAdded', { city: city.name }),
            );
            // After the screen has gone, focus returns to "add" (design 5.2).
            clearTimeout(focusTimer.current);
            focusTimer.current = setTimeout(() => {
              const node = findNodeHandle(addButton.current);
              if (node) AccessibilityInfo.setAccessibilityFocus(node);
            }, 400);
          }}
        />
      ) : null}
    </View>
  );
}

type ListState = 'loading' | 'ready' | 'error';

/**
 * Design 5.2: a full screen from the end side, the search field focused.
 * Sprint 11 (design 3.7.2):  for "עיר אחרת" — only listed
 * cities, no "as written", and a note that the city stays on the device.
 */
export function CitySearchScreen({
  country,
  colorScheme,
  reduceMotion,
  insetsTop,
  insetsBottom,
  onClose,
  onPick,
  mode = 'add',
  note,
}: {
  country: CountryInfo;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  onPick: (city: TripCity, entry: CityEntry | null) => void;
  mode?: 'add' | 'pick';
  /** Under the field, in pick mode. */
  note?: string;
}) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<Awaited<ReturnType<typeof cityIndex>> | null>(null);
  const [listState, setListState] = useState<ListState>('loading');
  const [slow, setSlow] = useState(false);
  const area = countryName(country, i18n.language);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => current && setSlow(true), motion.skeletonDelay);
    cityIndex(country.adm0)
      .then((built) => {
        if (!current) return;
        setIndex(built);
        setListState('ready');
      })
      .catch((error: unknown) => {
        console.error(
          '[cities] list failed to load',
          (error as { name?: string })?.name ?? 'no name',
        );
        if (current) setListState('error');
      })
      .finally(() => clearTimeout(timer));
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [country.adm0]);

  const results = useMemo(() => (index ? searchCities(index, query) : []), [index, query]);
  const typed = query.trim();
  const typedLength = codePointLength(typed);
  const showAsWritten =
    mode === 'add' && typed !== '' && typedLength <= NAME_MAX && !hasExactMatch(results, typed);
  const tooLong = typedLength > NAME_MAX;

  // The count, 600 ms after the last keystroke (sprint 1's search delay).
  useEffect(() => {
    if (!typed || listState !== 'ready') return;
    const timer = setTimeout(() => {
      AccessibilityInfo.announceForAccessibility(
        results.length === 0
          ? t('citySearch.resultsNone')
          : results.length === 1
            ? t('citySearch.resultsOne')
            : t('citySearch.resultsMany', { n: results.length }),
      );
    }, motion.searchAnnounceDelay);
    return () => clearTimeout(timer);
  }, [typed, results.length, listState, t]);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(
      withTiming(1, {
        duration: reduceMotion ? motion.short : motion.medium,
        easing: reduceMotion ? Easing.linear : Easing.bezier(0.2, 0, 0, 1),
        reduceMotion: ReduceMotion.Never,
      }),
    );
  }, [progress, reduceMotion]);
  const from = I18nManager.isRTL ? -width : width;
  const enter = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: progress.value }
      : { transform: [{ translateX: (1 - progress.value) * from }] },
  );

  const pick = (city: CityEntry) =>
    onPick({ geonameId: city.id, name: displayName(city, i18n.language) }, city);

  const empty = listState === 'ready' && index?.length === 0;

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View
        style={[styles.screen, { backgroundColor: palette.canvas, paddingTop: insetsTop }, enter]}
        testID="city-search"
      >
        <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('citySearch.back')}
            onPress={onClose}
            style={styles.iconButton}
            testID="city-search-back"
          >
            <BackIcon color={palette.textPrimary} />
          </Pressable>
          <View
            style={[
              styles.field,
              { borderColor: palette.focusRing, backgroundColor: palette.surface },
            ]}
          >
            <SearchIcon color={palette.textSecondary} size={20} />
            <TextInput
              value={query}
              onChangeText={(text) => setQuery(cleanTypedName(text))}
              placeholder={t('citySearch.placeholder')}
              placeholderTextColor={palette.textTertiary}
              accessibilityLabel={t('citySearch.fieldA11y', { country: area })}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              maxLength={NAME_MAX * 2}
              style={[styles.input, { color: palette.textPrimary }]}
              testID="city-search-field"
            />
          </View>
        </View>
        {note ? (
          <Text style={[styles.footnote, styles.note, { color: palette.textSecondary }]}>
            {note}
          </Text>
        ) : null}
        {tooLong ? (
          <Text
            style={[styles.footnote, styles.error, { color: palette.textAlert }]}
            accessibilityLiveRegion="polite"
          >
            {t('citySearch.tooLong')}
          </Text>
        ) : null}
        {listState === 'error' ? (
          <View style={styles.notice}>
            <InlineNotice text={t('citySearch.loadError')} colorScheme={colorScheme} />
          </View>
        ) : null}

        {listState === 'loading' ? (
          slow ? (
            <View style={styles.loading} accessibilityLabel={t('citySearch.loading')} accessible>
              <ActivityIndicator color={palette.textTertiary} />
            </View>
          ) : null
        ) : (
          <FlatList
            data={results}
            keyExtractor={(city) => String(city.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insetsBottom + 16 }}
            ListHeaderComponent={
              empty ? (
                <View style={styles.emptyState}>
                  <Text style={[styles.title3, { color: palette.textPrimary }]}>
                    {t('citySearch.noCitiesTitle')}
                  </Text>
                  <Text style={[styles.body, styles.centerText, { color: palette.textSecondary }]}>
                    {t('citySearch.noCitiesBody')}
                  </Text>
                </View>
              ) : !typed && results.length > 0 ? (
                <Text
                  style={[styles.caption, styles.listLabel, { color: palette.textSecondary }]}
                  accessibilityRole="header"
                >
                  {t('citySearch.largest')}
                </Text>
              ) : typed && results.length === 0 && listState === 'ready' ? (
                <Text style={[styles.body, styles.listLabel, { color: palette.textSecondary }]}>
                  {t('citySearch.noResults', { q: typed, country: area })}
                </Text>
              ) : undefined
            }
            renderItem={({ item }) => {
              const shown = displayName(item, i18n.language);
              const other = shown === item.nameEn ? null : item.nameEn;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={other ? `${shown}, ${other}` : shown}
                  accessibilityHint={t('citySearch.rowHint')}
                  onPress={() => pick(item)}
                  style={({ pressed }) => [
                    styles.result,
                    { borderBottomColor: palette.borderSubtle },
                    pressed && { backgroundColor: palette.pressed },
                  ]}
                  testID={`city-result-${item.id}`}
                >
                  <Text style={[styles.bodyStrong, styles.left, { color: palette.textPrimary }]}>
                    {isolateOwn(shown)}
                  </Text>
                  {other ? (
                    <Text
                      style={[styles.footnote, { color: palette.textSecondary }]}
                      numberOfLines={1}
                    >
                      {isolateOwn(other)}
                    </Text>
                  ) : null}
                </Pressable>
              );
            }}
            ListFooterComponent={
              showAsWritten ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onPick({ geonameId: null, name: typed }, null)}
                  style={({ pressed }) => [
                    styles.asWritten,
                    { borderTopColor: palette.borderSubtle },
                    pressed && { backgroundColor: palette.pressed },
                  ]}
                  testID="city-as-written"
                >
                  <PlusIcon color={palette.link} size={20} />
                  <View style={styles.grow}>
                    <Text style={[styles.body, { color: palette.textPrimary }]}>
                      {t('citySearch.addAsWritten', { q: typed })}
                    </Text>
                    <Text style={[styles.footnote, { color: palette.textSecondary }]}>
                      {t('citySearch.addAsWrittenNote')}
                    </Text>
                  </View>
                </Pressable>
              ) : undefined
            }
          />
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  row: {
    minHeight: layout.listRowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingStart: 16,
    paddingEnd: 4,
    paddingVertical: 8,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { borderTopWidth: 1 },
  number: {
    minWidth: 24,
    textAlign: 'center',
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 24,
    borderRadius: radius.pill,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  grow: { flex: 1, gap: 2 },
  note: { paddingHorizontal: 16, paddingBottom: 8 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  left: { textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  title3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, textAlign: 'center' },
  centerText: { textAlign: 'center' },
  iconButton: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    minHeight: layout.touchTargetMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  limit: { paddingHorizontal: 16, paddingVertical: 14 },
  screen: { flex: 1 },
  bar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 4 },
  field: {
    flex: 1,
    minHeight: layout.touchTargetMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 2,
    marginEnd: 12,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, paddingVertical: 8 },
  error: { paddingHorizontal: 24, paddingBottom: 8 },
  notice: { paddingHorizontal: 16, paddingBottom: 8 },
  loading: { padding: 24, alignItems: 'center' },
  listLabel: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  result: {
    minHeight: layout.listRowMin,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  asWritten: {
    minHeight: layout.listRowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 24 },
});
