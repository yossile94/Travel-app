/**
 * Sprint 5 design 5: choosing an airport. A full screen like "add a city"
 * (sprint 3, 5.2): the search field focused, the trip's country and Israel
 * before typing, a 3-letter code first. Works offline (the list ships in the
 * app); never "add as written": an airport without a time zone can't be saved.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  I18nManager,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
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
import { BackIcon, SearchIcon } from '@/components/icons';
import { countryByAdm0 } from '@/features/globe/countryData';
import { isolateLtr, isolateOwn } from '@/features/globe/BoardingPassCard';
import { countryName } from '@/features/trips/countryName';
import { colors, fonts, layout, motion, radius, type ColorScheme } from '@/theme/tokens';

import {
  airportTitle,
  defaultGroups,
  indexAirports,
  loadAirports,
  searchAirports,
  type Airport,
} from './airportsData';
import { spellCode } from './flightTime';

type Index = ReturnType<typeof indexAirports>;

/** The countries' names for the search, from the globe's data (Hebrew and English). */
function namesOf(adm0: string): string[] {
  const c = countryByAdm0(adm0);
  return c ? [c.nameHe, c.nameEn] : [];
}

export function AirportPicker({
  tripAdm0,
  israelFirst,
  colorScheme,
  reduceMotion,
  insetsTop,
  insetsBottom,
  onClose,
  onPick,
}: {
  tripAdm0: string;
  /** The origin of an outbound flight: Israel's group first (design 5). */
  israelFirst: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  onPick: (airport: Airport, title: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const palette = colors[colorScheme];
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [airports, setAirports] = useState<Airport[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => current && setSlow(true), motion.skeletonDelay);
    loadAirports()
      .then((list) => current && setAirports(list))
      .catch((error: unknown) => {
        console.error('[airports] list failed to load', (error as Error)?.name ?? 'no name');
        if (current) setFailed(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, []);

  const index = useMemo<Index | null>(
    () => (airports ? indexAirports(airports, (iso) => namesOfIso(airports, iso)) : null),
    [airports],
  );
  const typed = query.trim();
  const results = useMemo(
    () => (index && typed ? searchAirports(index, typed) : []),
    [index, typed],
  );

  useEffect(() => {
    if (!typed || !index) return;
    const timer = setTimeout(() => {
      AccessibilityInfo.announceForAccessibility(
        results.length === 0
          ? t('airport.none')
          : results.length === 1
            ? t('airport.countOne')
            : t('airport.countMany', { n: results.length }),
      );
    }, motion.searchAnnounceDelay);
    return () => clearTimeout(timer);
  }, [typed, results.length, index, t]);

  const sections = useMemo(() => {
    if (!airports) return [];
    if (typed) return [{ key: 'results', title: null as string | null, data: results }];
    const { inCountry, israel } = defaultGroups(airports, tripAdm0);
    const country = countryByAdm0(tripAdm0);
    const countryGroup = {
      key: 'country',
      title: t('airport.groupCountry', {
        country: country ? countryName(country, i18n.language) : '',
      }),
      data: inCountry,
    };
    const israelGroup = { key: 'israel', title: t('airport.groupIsrael'), data: israel };
    const groups = israelFirst ? [israelGroup, countryGroup] : [countryGroup, israelGroup];
    return groups.filter((g) => g.data.length > 0);
  }, [airports, typed, results, tripAdm0, israelFirst, t, i18n.language]);

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
        testID="airport-picker"
      >
        <StatusBar style={colorScheme === 'light' ? 'dark' : 'light'} />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('flight.back')}
            onPress={onClose}
            style={styles.iconButton}
            testID="airport-picker-back"
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
              onChangeText={setQuery}
              placeholder={t('airport.placeholder')}
              placeholderTextColor={palette.textTertiary}
              accessibilityLabel={t('airport.search')}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              maxLength={60}
              style={[styles.input, { color: palette.textPrimary }]}
              testID="airport-picker-field"
            />
          </View>
        </View>
        {failed ? (
          <View style={styles.notice}>
            <InlineNotice text={t('airport.loadError')} colorScheme={colorScheme} />
          </View>
        ) : !airports ? (
          slow ? (
            <View
              style={styles.loading}
              accessible
              accessibilityLabel={t('airport.loading')}
              testID="airport-picker-skeleton"
            >
              <ActivityIndicator color={palette.textTertiary} />
            </View>
          ) : null
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(a) => a.iata}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled={false}
            contentContainerStyle={{ paddingBottom: insetsBottom + 16 }}
            ListEmptyComponent={
              typed ? (
                <Text
                  style={[styles.body, styles.listLabel, { color: palette.textSecondary }]}
                  testID="airport-picker-empty"
                >
                  {t('airport.none')}
                </Text>
              ) : undefined
            }
            renderSectionHeader={({ section }) =>
              section.title ? (
                <Text
                  style={[styles.caption, styles.listLabel, { color: palette.textSecondary }]}
                  accessibilityRole="header"
                  testID={`airport-group-${section.key}`}
                >
                  {section.title}
                </Text>
              ) : null
            }
            renderItem={({ item }) => {
              const title = airportTitle(item, i18n.language);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${title.replace(' · ', ', ')}, ${item.name}, ${spellCode(item.iata)}`}
                  accessibilityHint={t('airport.rowHint')}
                  onPress={() => onPick(item, title)}
                  style={({ pressed }) => [
                    styles.result,
                    pressed && { backgroundColor: palette.pressed },
                  ]}
                  testID={`airport-result-${item.iata}`}
                >
                  <View style={styles.grow}>
                    <Text
                      style={[styles.bodyStrong, { color: palette.textPrimary }]}
                      numberOfLines={2}
                    >
                      {isolateOwn(title)}
                    </Text>
                    <Text
                      style={[styles.footnote, { color: palette.textSecondary }]}
                      numberOfLines={1}
                    >
                      {isolateLtr(item.name)}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.code,
                      { backgroundColor: palette.tag, color: palette.textPrimary },
                    ]}
                  >
                    {item.iata}
                  </Text>
                </Pressable>
              );
            }}
          />
        )}
      </Animated.View>
    </Modal>
  );
}

/** Country names by ISO2, through an airport of that country (the list carries adm0). */
function namesOfIso(airports: Airport[], iso2: string): string[] {
  const any = airports.find((a) => a.country === iso2);
  return any ? namesOf(any.adm0) : [];
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingEnd: 16, minHeight: 64 },
  iconButton: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }],
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 2,
    paddingHorizontal: 12,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, paddingVertical: 8 },
  notice: { padding: 16 },
  loading: { padding: 32, alignItems: 'center' },
  listLabel: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  result: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  grow: { flex: 1 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  code: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1.6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
});
