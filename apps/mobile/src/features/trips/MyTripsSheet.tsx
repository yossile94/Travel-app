/**
 * "My trips" (sprint 2 design 5, AC-5): every trip in one sheet, upcoming
 * soonest first, then past latest first. The first page of both sections is
 * asked for at once (AC-10); past rows show once upcoming has ended, so the
 * order is always right. Tapping a trip flies to its country with the trip
 * open in the card (design 5.3).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { AlertIcon, CloudOffIcon, GlobePlusIcon } from '@/components/icons';
import { countryByAdm0 } from '@/features/globe/countryData';
import { colors, fonts, layout, radius, type ColorScheme } from '@/theme/tokens';

import { ActiveBadge } from './CardTrips';
import { formatRange, formatRangeA11y, isActive, todayPg } from './tripDates';
import type { Trip } from './tripsApi';
import { useTrips } from './TripsProvider';
import { useTripList } from './useTripList';

interface Props {
  visible: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  onOpenTrip: (trip: Trip) => void;
}

type Item = Trip | 'none';

export function MyTripsSheet({ visible, onOpenTrip, insetsTop, ...sheet }: Props) {
  const { t } = useTranslation();
  const palette = colors[sheet.colorScheme];
  const { height } = useWindowDimensions();
  const trips = useTrips();
  const { state, reload, loadMore } = useTripList({
    enabled: visible,
    reloadKey: trips.changes,
    parallelFirstPage: true,
  });
  const today = todayPg();

  // Announcements: loading once it lasts, then loaded / more loaded (design 5.2, 5.4).
  const announcedMore = useRef(0);
  useEffect(() => {
    if (state.showSkeleton) AccessibilityInfo.announceForAccessibility(t('myTrips.loading'));
  }, [state.showSkeleton, t]);
  const rowCount = state.upcoming.length + state.past.length;
  useEffect(() => {
    if (state.status === 'offline') AccessibilityInfo.announceForAccessibility(t('myTrips.offline'));
  }, [state.status, t]);
  useEffect(() => {
    if (rowCount > 20 && rowCount !== announcedMore.current) {
      announcedMore.current = rowCount;
      AccessibilityInfo.announceForAccessibility(t('myTrips.loadedMore'));
    }
  }, [rowCount, t]);

  const sections: { key: 'upcoming' | 'past'; title: string; data: Item[] }[] = [];
  if (state.status === 'ready' && rowCount > 0) {
    sections.push({
      key: 'upcoming',
      title: t('myTrips.upcoming'),
      data: state.upcoming.length > 0 ? state.upcoming : ['none'],
    });
    if (state.past.length > 0) sections.push({ key: 'past', title: t('myTrips.past'), data: state.past });
  }

  const renderTrip = (trip: Trip) => {
    const country = countryByAdm0(trip.countryAdm0);
    const countryName = country?.nameHe ?? trip.countryAdm0;
    const active = isActive(trip.startDate, trip.endDate, today);
    const a11y = t(active ? 'trips.rowA11yActive' : 'trips.rowA11y', {
      name: `${trip.title}, ${countryName}`,
      dates: formatRangeA11y(trip.startDate, trip.endDate, t),
    });
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={t('myTrips.rowHint')}
        onPress={() => onOpenTrip(trip)}
        style={({ pressed }) => [
          styles.row,
          { borderBottomColor: palette.borderSubtle },
          pressed && { backgroundColor: palette.pressed },
        ]}
        testID={`my-trip-${trip.id}`}
      >
        {active ? <View style={[styles.activeBar, { backgroundColor: palette.activeBar }]} /> : null}
        <View style={styles.rowText}>
          <Text style={[styles.caption, { color: palette.textSecondary }]}>{countryName}</Text>
          <Text
            style={[styles.bodyStrong, { color: palette.textPrimary }]}
            numberOfLines={2}
            maxFontSizeMultiplier={2}
          >
            {trip.title}
          </Text>
          <Text style={[styles.footnote, styles.tabular, { color: palette.textSecondary }]}>
            {formatRange(trip.startDate, trip.endDate, t)}
          </Text>
        </View>
        <View style={styles.end} importantForAccessibility="no-hide-descendants">
          <Text style={[styles.code, { backgroundColor: palette.tag, color: palette.textPrimary }]}>
            {trip.countryAdm0}
          </Text>
          {active ? <ActiveBadge colorScheme={sheet.colorScheme} /> : null}
        </View>
      </Pressable>
    );
  };

  const centered = (icon: ReactNode, title: string, body?: string, action?: ReactNode) => (
    <View style={styles.center} accessibilityLiveRegion="polite">
      {icon}
      <Text style={[styles.title3, { color: palette.textPrimary }]}>{title}</Text>
      {body ? <Text style={[styles.body, { color: palette.textSecondary }]}>{body}</Text> : null}
      {action}
    </View>
  );

  return (
    <BottomSheet
      {...sheet}
      visible={visible}
      maxHeight={height - insetsTop - 12}
      testID="my-trips-sheet"
    >
      <Text style={[styles.title2, { color: palette.textPrimary }]} accessibilityRole="header">
        {t('myTrips.title')}
      </Text>
      {state.offlineStale ? (
        <View style={styles.block}>
          <InlineNotice text={t('myTrips.offlineStale')} colorScheme={sheet.colorScheme} />
        </View>
      ) : null}

      {state.status === 'loading' ? (
        state.showSkeleton ? (
          <View style={styles.block} importantForAccessibility="no-hide-descendants">
            <Text style={[styles.title3, { color: palette.textPrimary }]}>{t('myTrips.upcoming')}</Text>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <View style={[styles.bar, { width: '30%', backgroundColor: palette.skeleton }]} />
                <View style={[styles.bar, { width: '65%', backgroundColor: palette.skeleton }]} />
                <View style={[styles.bar, { width: '45%', backgroundColor: palette.skeleton }]} />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.placeholder} />
        )
      ) : state.status === 'offline' ? (
        centered(
          <CloudOffIcon color={palette.textTertiary} size={48} />,
          t('myTrips.offline'),
          t('myTrips.offlineBody'),
        )
      ) : state.status === 'error' ? (
        centered(
          <AlertIcon color={palette.textTertiary} size={48} />,
          t('myTrips.error'),
          undefined,
          <Button
            kind="secondary"
            label={t('myTrips.retry')}
            onPress={() => void reload()}
            colorScheme={sheet.colorScheme}
          />,
        )
      ) : state.status === 'ready' && rowCount === 0 ? (
        centered(
          <GlobePlusIcon color={palette.textTertiary} size={48} />,
          t('myTrips.emptyTitle'),
          t('myTrips.emptyBody'),
        )
      ) : (
        <SectionList
          style={styles.list}
          sections={sections}
          keyExtractor={(item, index) => (item === 'none' ? `none-${index}` : item.id)}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { backgroundColor: palette.surface }]}>
              <Text style={[styles.title3, { color: palette.textPrimary }]} accessibilityRole="header">
                {section.title}
              </Text>
            </View>
          )}
          renderItem={({ item }) =>
            item === 'none' ? (
              <Text style={[styles.footnote, styles.none, { color: palette.textTertiary }]}>
                {t('myTrips.upcomingNone')}
              </Text>
            ) : (
              renderTrip(item)
            )
          }
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            state.loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator size={20} color={palette.textTertiary} />
                <Text style={[styles.footnote, { color: palette.textSecondary }]}>
                  {t('myTrips.loadingMore')}
                </Text>
              </View>
            ) : state.moreError ? (
              <View style={styles.footer}>
                <Text style={[styles.footnote, { color: palette.textSecondary }]}>
                  {t('myTrips.moreError')}
                </Text>
                <Button
                  kind="text"
                  label={t('myTrips.retry')}
                  onPress={() => void loadMore()}
                  colorScheme={sheet.colorScheme}
                />
              </View>
            ) : undefined
          }
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title2: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    marginBottom: 8,
    textAlign: 'left',
  },
  title3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, textAlign: 'center' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  tabular: { fontVariant: ['tabular-nums'] },
  block: { marginTop: 8 },
  placeholder: { height: 120 },
  list: { flexGrow: 0 },
  sectionHeader: { minHeight: 40, justifyContent: 'center', alignItems: 'flex-start' },
  row: {
    minHeight: layout.tripRowMin,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  activeBar: { position: 'absolute', top: 12, bottom: 12, start: 0, width: 3, borderRadius: 2 },
  rowText: { flex: 1, minWidth: 160, gap: 2 },
  end: { alignItems: 'flex-end', gap: 6 },
  code: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  none: { paddingVertical: 12, paddingHorizontal: 16 },
  center: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 16, gap: 8 },
  footer: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  skeletonRow: { paddingVertical: 12, gap: 8 },
  bar: { height: 12, borderRadius: 6 },
});
