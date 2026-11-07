/**
 * Sprint 14 F-043 (AC-1, AC-5; design 1.2 – 1.6, Raz design approval): the
 * hotel search at the top of the hotel form, and the "Selected from Google"
 * row that replaces it once a hotel is linked.
 *
 * - After 3 letters and 300ms; at most 5 rows; inside the flow, not floating.
 * - One Autocomplete session from the first focus to a pick or ✕.
 * - No key on the server ('unavailable'): hidden until the app restarts.
 *   Offline: hidden (the linked row stays, "Change" off). Quota or a failure:
 *   "not available right now", and typing again tries again.
 * - "Google Maps" under every list with results or "none found" (Raz 4).
 */
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, type TextInputHandle } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { BedIcon, ClearIcon, SearchIcon } from '@/components/icons';
import { isolateOwn } from '@/features/globe/BoardingPassCard';
import { codePointLength } from '@/features/trips/tripDates';
import { colors, fonts, motion, radius, type ColorScheme } from '@/theme/tokens';

import { GoogleAttribution } from './GoogleAttribution';
import { pickHotel, searchHotels, type PickedPlace, type Suggestion } from './placesApi';

export const MIN_LETTERS = 3;
export const DEBOUNCE_MS = 300;

/** The server has no key: no search until the app restarts (AC-5). */
let serverUnavailable = false;
const markUnavailable = () => {
  serverUnavailable = true;
};
/** Tests only. */
export const resetPlaceSearchForTests = () => {
  serverUnavailable = false;
};

type ListState =
  | { kind: 'idle' }
  | { kind: 'loading'; previous: Suggestion[]; n: number }
  | { kind: 'results'; items: Suggestion[] }
  | { kind: 'unavailable' };

export function PlaceSearchField({
  regions,
  localLanguage,
  linkedName,
  linkedAttribution = true,
  colorScheme,
  onPicked,
}: {
  /** The trip's countries as region codes; empty: no search. */
  regions: string[];
  /** The driver's language for the trip's country. */
  localLanguage: string;
  /** The saved or just-picked hotel's name when linked to Google. */
  linkedName: string | null;
  /** ADR-021 §5: some of Google's text is still in the form. */
  linkedAttribution?: boolean;
  colorScheme: ColorScheme;
  onPicked: (place: PickedPlace) => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const [offline, setOffline] = useState(false);
  const [hidden, setHidden] = useState(serverUnavailable);
  const [replacing, setReplacing] = useState(false);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ListState>({ kind: 'idle' });
  const [picking, setPicking] = useState<string | null>(null);
  const [detailsFailed, setDetailsFailed] = useState(false);
  // Design 1.4: the skeleton only after motion.skeletonDelay, for the request it waits on.
  const [skeletonFor, setSkeletonFor] = useState(-1);
  const session = useRef<string | null>(null);
  const asked = useRef(0);
  const input = useRef<TextInputHandle>(null);

  useEffect(() => NetInfo.addEventListener((s) => setOffline(s.isConnected === false)), []);
  const waitingOn = list.kind === 'loading' && list.previous.length === 0 ? list.n : -1;

  // Debounced search: only the latest answer counts.
  useEffect(() => {
    // Under 3 letters the list shows nothing (see `shown`), and nothing is asked.
    if (codePointLength(query.trim()) < MIN_LETTERS) return;
    const n = ++asked.current;
    const timer = setTimeout(() => {
      session.current ??= Crypto.randomUUID();
      setList((l) => ({ kind: 'loading', previous: l.kind === 'results' ? l.items : [], n }));
      void searchHotels({
        input: query.trim(),
        session: session.current,
        regions,
        language: i18n.language,
      }).then((r) => {
        if (n !== asked.current) return;
        if (r.kind === 'ok') {
          setList({ kind: 'results', items: r.suggestions });
          setTimeout(
            () =>
              AccessibilityInfo.announceForAccessibility(
                r.suggestions.length
                  ? t('hotel.search.count', { count: r.suggestions.length })
                  : t('hotel.search.empty'),
              ),
            motion.searchAnnounceDelay,
          );
        } else if (r.kind === 'unavailable') {
          markUnavailable();
          setList({ kind: 'unavailable' });
          setHidden(true);
        } else setList({ kind: 'unavailable' });
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, regions, i18n.language, t]);

  useEffect(() => {
    if (waitingOn < 0) return;
    const timer = setTimeout(() => setSkeletonFor(waitingOn), motion.skeletonDelay);
    return () => clearTimeout(timer);
  }, [waitingOn]);

  const clear = () => {
    asked.current++;
    session.current = null;
    setQuery('');
    setDetailsFailed(false);
    setList({ kind: 'idle' });
  };

  const choose = async (s: Suggestion) => {
    if (picking) return;
    Keyboard.dismiss();
    setPicking(s.placeId);
    setDetailsFailed(false);
    session.current ??= Crypto.randomUUID();
    const r = await pickHotel({ placeId: s.placeId, session: session.current, localLanguage });
    setPicking(null);
    if (r.kind === 'ok') {
      session.current = null;
      asked.current++;
      setQuery('');
      setList({ kind: 'idle' });
      setReplacing(false);
      onPicked(r.place);
      AccessibilityInfo.announceForAccessibility(t('hotel.search.filledA11y', { name: s.name }));
    } else if (r.kind === 'unavailable') {
      markUnavailable();
      setHidden(true);
    } else setDetailsFailed(true);
  };

  const details = (
    <Text
      style={[styles.title3, { color: p.textPrimary }]}
      accessibilityRole="header"
      testID="hotel-details-title"
    >
      {t('hotel.details')}
    </Text>
  );

  if (linkedName && !replacing) {
    return (
      <>
        <View style={[styles.linked, { backgroundColor: p.surfaceAlt }]} testID="place-linked">
          <BedIcon color={p.textSecondary} size={20} />
          <View style={styles.grow}>
            <Text style={[styles.caption, { color: p.textSecondary }]}>{t('hotel.linked')}</Text>
            <Text style={[styles.bodyStrong, { color: p.textPrimary }]} numberOfLines={2}>
              {isolateOwn(linkedName)}
            </Text>
            {linkedAttribution ? <GoogleAttribution colorScheme={colorScheme} /> : null}
          </View>
          <Button
            kind="text"
            label={t('hotel.replace')}
            a11yHint={t('hotel.replaceA11y')}
            disabled={offline || hidden}
            onPress={() => {
              setReplacing(true);
              setTimeout(() => input.current?.focus(), 0);
            }}
            colorScheme={colorScheme}
            testID="place-replace"
          />
        </View>
        {details}
      </>
    );
  }

  if (hidden || offline || regions.length === 0) return null;

  const shown: ListState = codePointLength(query.trim()) < MIN_LETTERS ? { kind: 'idle' } : list;
  const items =
    shown.kind === 'results' ? shown.items : shown.kind === 'loading' ? shown.previous : [];
  const loadingFirst = shown.kind === 'loading' && shown.previous.length === 0;
  const skeleton = shown.kind === 'loading' && loadingFirst && skeletonFor === shown.n;

  return (
    <>
      <View testID="place-search">
        <Text style={[styles.label, { color: p.textSecondary }]} importantForAccessibility="no">
          {t('hotel.search.label')}
        </Text>
        <View
          style={[
            styles.box,
            { backgroundColor: p.surface, borderColor: p.borderControl },
            picking !== null && styles.dim,
          ]}
        >
          <SearchIcon color={p.textSecondary} size={20} />
          <TextInput
            ref={input}
            value={query}
            editable={picking === null}
            onChangeText={(v) => {
              setDetailsFailed(false);
              setQuery(v);
            }}
            onFocus={() => {
              session.current ??= Crypto.randomUUID();
            }}
            placeholder={t('hotel.search.placeholder')}
            placeholderTextColor={p.textTertiary}
            accessibilityLabel={t('hotel.search.label')}
            accessibilityHint={t('hotel.search.help')}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            style={[styles.input, { color: p.textPrimary }]}
            maxFontSizeMultiplier={2}
            testID="place-search-input"
          />
          {shown.kind === 'loading' && !loadingFirst ? (
            <ActivityIndicator size="small" color={p.textSecondary} />
          ) : query && picking === null ? (
            <Pressable
              onPress={clear}
              accessibilityRole="button"
              accessibilityLabel={t('hotel.search.clear')}
              hitSlop={12}
              style={styles.clear}
              testID="place-search-clear"
            >
              <ClearIcon color={p.textSecondary} size={20} />
            </Pressable>
          ) : null}
        </View>
        <Text style={[styles.footnote, { color: p.textSecondary }]}>{t('hotel.search.help')}</Text>

        {detailsFailed ? (
          <InlineNotice
            text={t('hotel.search.detailsError')}
            colorScheme={colorScheme}
            testID="place-details-error"
          />
        ) : null}

        {shown.kind === 'unavailable' ? (
          <InlineNotice
            text={t('hotel.search.unavailable')}
            colorScheme={colorScheme}
            testID="place-search-unavailable"
          />
        ) : skeleton ? (
          <View
            style={[styles.list, { backgroundColor: p.surfaceRaised, borderColor: p.borderSubtle }]}
            testID="place-search-loading"
          >
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.skeleton, { backgroundColor: p.skeleton }]} />
            ))}
          </View>
        ) : shown.kind === 'results' || items.length > 0 ? (
          <View
            style={[styles.list, { backgroundColor: p.surfaceRaised, borderColor: p.borderSubtle }]}
            testID="place-search-list"
          >
            {items.length === 0 ? (
              <Text
                style={[styles.footnote, styles.empty, { color: p.textSecondary }]}
                testID="place-search-empty"
              >
                {t('hotel.search.empty')}
              </Text>
            ) : (
              items.map((s, i) => (
                <Pressable
                  key={s.placeId}
                  onPress={() => void choose(s)}
                  disabled={picking !== null}
                  accessibilityRole="button"
                  accessibilityLabel={t('hotel.search.rowA11y', { name: s.name, city: s.place })}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && { borderTopWidth: 1, borderTopColor: p.borderSubtle },
                    pressed && { backgroundColor: p.pressed },
                    picking !== null && picking !== s.placeId && styles.dim,
                  ]}
                  testID={`place-row-${i}`}
                >
                  <BedIcon color={p.textSecondary} size={20} />
                  <View style={styles.grow}>
                    <Text style={[styles.bodyStrong, { color: p.textPrimary }]} numberOfLines={2}>
                      {isolateOwn(s.name)}
                    </Text>
                    {s.place ? (
                      <Text
                        style={[styles.footnote, { color: p.textSecondary }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {isolateOwn(s.place)}
                      </Text>
                    ) : null}
                  </View>
                  {picking === s.placeId ? (
                    <ActivityIndicator size="small" color={p.textSecondary} />
                  ) : null}
                </Pressable>
              ))
            )}
            <View style={[styles.attributionRow, { borderTopColor: p.borderSubtle }]}>
              <GoogleAttribution colorScheme={colorScheme} />
            </View>
          </View>
        ) : null}
      </View>
      {details}
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 6,
    textAlign: 'left',
  },
  box: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingVertical: 10,
    textAlign: 'auto',
  },
  clear: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: -12,
  },
  footnote: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    textAlign: 'left',
  },
  list: { marginTop: 8, borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dim: { opacity: 0.5 },
  grow: { flex: 1 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  empty: { padding: 12, marginTop: 0 },
  skeleton: { height: 48, margin: 8, borderRadius: radius.xs * 2 },
  attributionRow: { borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  linked: {
    minHeight: 64,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, textAlign: 'left' },
});
