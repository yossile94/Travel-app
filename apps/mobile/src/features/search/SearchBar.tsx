/**
 * Country search over the globe (sprint 1 F-002; design docs/design/sprint-01
 * section 2): a magnifier button that opens a full-width field, with results
 * that behave exactly like a tap on the globe.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
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
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

import { ChromeButton } from '@/components/ChromeButton';
import { BackIcon, ClearIcon, SearchIcon } from '@/components/icons';
import { colors, fonts, globe, layout, motion, radius, type ColorScheme } from '@/theme/tokens';

import { isolateLtr } from '../globe/BoardingPassCard';
import { logSearchResults } from '../globe/perfLog';
import { searchCountries, type SearchEntry } from './search';

interface Props {
  open: boolean;
  colorScheme: ColorScheme;
  insetsTop: number;
  insetsBottom: number;
  onOpen: () => void;
  /** Closed without choosing a country. */
  onClose: () => void;
  onSelect: (adm0: string) => void;
}

/** Results start 8dp below the 48dp field row. */
const RESULTS_OFFSET = layout.chromeRowTop + layout.touchTargetMin + 8;

export function SearchBar({
  open,
  colorScheme,
  insetsTop,
  insetsBottom,
  onOpen,
  onClose,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const [query, setQuery] = useState('');
  const { results, more } = useMemo(() => searchCountries(query), [query]);

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

  const close = useCallback(() => {
    Keyboard.dismiss();
    setQuery('');
    onClose();
  }, [onClose]);

  const select = useCallback(
    (entry: SearchEntry) => {
      Keyboard.dismiss();
      setQuery('');
      onSelect(entry.adm0);
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

  const announcement = useAnnouncement(query, results.length, more);

  // The results end 8dp above the keyboard, or 16dp above the navigation bar.
  // The window doesn't resize for the keyboard (design 2.6), so this is computed.
  const keyboard = useAnimatedKeyboard();
  const screenHeight = Dimensions.get('screen').height;
  const top = insetsTop + RESULTS_OFFSET;
  const listMaxHeight = useAnimatedStyle(() => {
    const bottomGap = keyboard.height.value > 0 ? keyboard.height.value + 8 : insetsBottom + 16;
    return { maxHeight: Math.max(layout.listRowMin, screenHeight - top - bottomGap) };
  });

  if (!open) {
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
    backgroundColor: palette.surface,
    borderColor: palette.borderSubtle,
    borderWidth: colorScheme === 'dark' ? 1 : 0,
    elevation: colorScheme === 'dark' ? 0 : 3,
  };

  return (
    <>
      <Pressable
        style={[styles.scrim, { top: insetsTop + RESULTS_OFFSET }]}
        onPress={onScrimPress}
        accessible={false}
        importantForAccessibility="no"
        testID="search-scrim"
      />

      <View
        style={[
          styles.field,
          surface,
          { top: insetsTop + layout.chromeRowTop, borderColor: palette.focusRing, borderWidth: 2 },
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
          value={query}
          onChangeText={onChangeText}
          onSubmitEditing={() => {
            if (results[0]) select(results[0]);
          }}
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
            onPress={() => setQuery('')}
            style={styles.iconButton}
            testID="search-clear"
          >
            <ClearIcon color={palette.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {query ? (
        <Animated.View style={[styles.results, surface, { top }, listMaxHeight]}>
          {results.length === 0 ? (
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
              data={results}
              keyExtractor={(entry) => entry.adm0}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: palette.borderSubtle }]} />
              )}
              renderItem={({ item }) => (
                <ResultRow entry={item} colorScheme={colorScheme} onPress={select} />
              )}
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
    </>
  );
}

function ResultRow({
  entry,
  colorScheme,
  onPress,
}: {
  entry: SearchEntry;
  colorScheme: ColorScheme;
  onPress: (entry: SearchEntry) => void;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const label = entry.parentHe
    ? t('search.rowTerritory', { name: entry.nameHe, parent: entry.parentHe, nameEn: entry.nameEn })
    : t('search.row', { name: entry.nameHe, nameEn: entry.nameEn });
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
      <View
        style={[styles.tag, { backgroundColor: palette.tag }]}
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.tagText, { color: palette.textSecondary }]}>{entry.adm0}</Text>
      </View>
    </Pressable>
  );
}

/** The live-region text, updated only after typing pauses and only when it changes. */
function useAnnouncement(query: string, count: number, more: boolean) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  useEffect(() => {
    if (!query) return;
    const timer = setTimeout(() => {
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
  }, [query, count, more, t]);
  // An empty field announces nothing, even before the timer has caught up.
  return query ? text : '';
}

const styles = StyleSheet.create({
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
    end: layout.chromeEdge,
    minHeight: layout.touchTargetMin,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
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
