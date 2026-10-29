/**
 * The country card's destination parts (country card fix, 4 and 6.1): the
 * entry line under the names, only when entry is banned or restricted; the
 * "Safety" state behind its tile; the one sheet both open, the only place with
 * the threat level (Yossi, 29.10); and "Sources" under the tiles.
 */
import { useRef, useState, type ComponentRef, type Ref } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ChevronEndIcon } from '@/components/icons';
import { SourcesSheet } from '@/features/climate/SourcesSheet';
import type { CountryInfo } from '@/features/globe/countryData';
import { countryName } from '@/features/trips/countryName';
import { colors, fonts, radius, type ColorScheme } from '@/theme/tokens';

import { useDestination, type Advisory, type Destination } from './destinationData';
import { checkedLongAgo, EntryTag, TravelInfoSheet, useOffline } from './DestinationFields';

export type TileBadge = 'offline' | 'stale' | null;

export interface SafetyState {
  advisory: Advisory | undefined;
  loading: boolean;
  /** No data, and the read failed. */
  failed: boolean;
  offline: boolean;
  /** From the saved copy offline, or checked over 30 days ago. */
  stale: boolean;
  badge: TileBadge;
}

/**
 * The "Safety" tile's state (5.5, 8): "offline" on a first offline launch;
 * "stale" offline from the saved copy, or checked over 30 days ago; nothing
 * while loading, after an online error, or when all is well. Offline wins.
 */
export function safetyState(
  adm0: string,
  { data, failed }: { data: Destination | null; failed: boolean },
  offline: boolean | null,
  now = Date.now(),
): SafetyState {
  const advisory = data?.advisories.get(adm0);
  const loading = !data && (!failed || offline === null);
  const noData = !data && failed && offline !== null;
  const fetched = advisory?.fetchedAt ?? null;
  const stale =
    Boolean(data) &&
    ((data!.from === 'device' && offline === true) ||
      (fetched !== null && checkedLongAgo(fetched, now)));
  const badge: TileBadge = noData && offline ? 'offline' : stale ? 'stale' : null;
  return { advisory, loading, failed: noData, offline: offline === true, stale, badge };
}

/** One source for the card: the data, the network, and the derived safety state. */
export function useSafety(adm0: string): SafetyState {
  const destination = useDestination();
  const offline = useOffline();
  return safetyState(adm0, destination, offline);
}

/**
 * The entry line (4.2): only banned or restricted, from the data or the saved
 * copy; hidden while loading, on an error, offline with nothing saved, and in
 * Israel. No threat level beside it.
 */
export function CardEntryLine({
  country,
  advisory,
  colorScheme,
  onOpen,
  ref,
}: {
  country: CountryInfo;
  advisory: Advisory | undefined;
  colorScheme: ColorScheme;
  onOpen: () => void;
  ref?: Ref<ComponentRef<typeof Pressable>>;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const status = advisory?.entryStatus ?? null;
  if (country.adm0 === 'ISR' || (status !== 'banned' && status !== 'restricted')) return null;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={t(status === 'banned' ? 'entry.bannedA11y' : 'entry.restrictedA11y')}
      accessibilityHint={t('advisory.rowHint')}
      onPress={onOpen}
      style={({ pressed }) => [styles.entryLine, pressed && { backgroundColor: palette.pressed }]}
      testID="card-entry-line"
    >
      <EntryTag status={status} colorScheme={colorScheme} testID="card-entry-tag" />
      <ChevronEndIcon color={palette.textTertiary} />
    </Pressable>
  );
}

/** The one "Entry and travel warnings" sheet of the card, for the entry line and the Safety tile. */
export function CardSafetySheet({
  country,
  safety,
  visible,
  colorScheme,
  reduceMotion,
  insetsBottom,
  onClose,
}: {
  country: CountryInfo;
  safety: SafetyState;
  visible: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
}) {
  const { i18n } = useTranslation();
  return (
    <TravelInfoSheet
      visible={visible}
      countryName={countryName(country, i18n.language)}
      advisory={safety.advisory}
      loading={safety.loading}
      failed={safety.failed}
      offline={safety.offline}
      stale={safety.stale}
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={onClose}
    />
  );
}

/** "Sources", under the tiles, for the temperature, the rate and the warnings (5.6). */
export function CardSources({
  colorScheme,
  reduceMotion,
  insetsBottom,
}: {
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const [open, setOpen] = useState(false);
  const link = useRef<ComponentRef<typeof Pressable>>(null);
  const close = () => {
    setOpen(false);
    // Focus goes back to "Sources" (sprint 3 design 1.3).
    const node = findNodeHandle(link.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  };
  return (
    <>
      <Pressable
        ref={link}
        accessibilityRole="button"
        accessibilityLabel={t('sources.linkA11y')}
        onPress={() => setOpen(true)}
        style={styles.sources}
        testID="card-sources"
      >
        <Text style={[styles.footnote, { color: palette.link }]}>{t('sources.link')}</Text>
      </Pressable>
      <SourcesSheet
        visible={open}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insetsBottom}
        onClose={close}
      />
    </>
  );
}

const styles = StyleSheet.create({
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  // A 48dp target that doesn't add 48dp to the card (sprint 3 design 1.1).
  sources: {
    minHeight: 48,
    minWidth: 48,
    marginTop: 4,
    marginBottom: -14,
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  entryLine: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 10,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: radius.xs,
  },
});
