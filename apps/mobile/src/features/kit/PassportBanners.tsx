/**
 * Sprint 10 AC-11, AC-14 (design 6): the passports against this trip, first
 * in the open row. Red: expires before departure; orange: short on return
 * (the country's rule, or 6 months); a gentle card when a traveler has no
 * date. Worked out on the device from the wallet; nothing is sent. A row
 * opens that person's passport over the card.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/fields';
import { AlertIcon, ChevronEndIcon, WarningIcon } from '@/components/icons';
import type { Advisory } from '@/features/destination/destinationData';
import { countryByAdm0 } from '@/features/globe/countryData';
import rawMeta from '@/features/globe/countryMeta.json';
import { tripPassports, validityMonths, type Holder } from '@/features/passport/passportModel';
import { PassportsScreen, type OpenPassport } from '@/features/passport/PassportScreens';
import {
  dismissedReminders,
  dismissReminder,
  usePassports,
} from '@/features/passport/passportStore';
import { isolateLtr, isolateOwn, numDate } from '@/features/passport/passportText';
import { countryName } from '@/features/trips/countryName';
import { formatDate } from '@/features/trips/tripDates';
import { colors, fonts, radius, type ColorScheme } from '@/theme/tokens';

const parents = rawMeta as unknown as Record<string, { parent?: string }>;

export interface PassportTrip {
  id: string;
  countryAdm0: string;
  startDate: string;
  endDate: string;
  travelers: readonly { name: string }[];
}

export function PassportBanners({
  trip,
  advisories,
  today,
  colorScheme,
  onToast,
}: {
  trip: PassportTrip;
  advisories: ReadonlyMap<string, Advisory> | undefined;
  today: string;
  colorScheme: ColorScheme;
  onToast: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const p = colors[colorScheme];
  const { status, holders } = usePassports();
  const [open, setOpen] = useState<OpenPassport | 'list' | null>(null);
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void dismissedReminders().then((ids) => alive && setDismissed(ids.has(trip.id)));
    return () => {
      alive = false;
    };
  }, [trip.id]);

  // Design 6.5: a wallet that can't be read shows nothing here, never "missing".
  if (status !== 'ready') return null;

  const rule = validityMonths(
    trip.countryAdm0,
    (adm0) => advisories?.get(adm0)?.passportValidityMonths,
    (adm0) => parents[adm0]?.parent,
  );
  const result = tripPassports(
    { start: trip.startDate, end: trip.endDate, travelers: trip.travelers },
    holders,
    rule.months,
    today,
  );
  const info = countryByAdm0(trip.countryAdm0);
  const country = info ? countryName(info, i18n.language) : trip.countryAdm0;
  const nameOf = (h: Holder) => (h.isMe ? t('passport.me') : isolateOwn(h.name));

  const banner = (kind: 'red' | 'orange', list: Holder[]) => {
    if (!list.length) return null;
    const red = kind === 'red';
    const one = list.length === 1 ? list[0]! : null;
    const title = one
      ? one.isMe
        ? t(red ? 'passport.banner.redMine' : 'passport.banner.orangeMine')
        : t(red ? 'passport.banner.redOf' : 'passport.banner.orangeOf', {
            name: isolateOwn(one.name),
          })
      : t(red ? 'passport.banner.redMany' : 'passport.banner.orangeMany', { n: list.length });
    const body = red
      ? t('passport.banner.redBody', { start: isolateLtr(numDate(trip.startDate)) })
      : !rule.fromCountry
        ? t('passport.banner.ruleDefault', { country })
        : rule.months === 0
          ? t('passport.banner.ruleZero', { country })
          : t('passport.banner.ruleCountry', { country, n: rule.months });
    const fg = red ? p.alertSubtleFg : p.entryRestrictedFg;
    return (
      <View
        style={[
          styles.banner,
          {
            backgroundColor: red ? p.alertSubtleBg : p.entryRestrictedBg,
            borderStartColor: red ? p.textAlert : p.ctaBg,
          },
          !red &&
            colorScheme === 'dark' && {
              borderColor: p.borderControl,
              borderWidth: 1,
              borderStartWidth: 4,
            },
        ]}
        testID={red ? 'card-passport-red' : 'card-passport-orange'}
      >
        <View
          style={styles.row}
          accessible
          accessibilityRole="header"
          accessibilityLabel={t(red ? 'passport.banner.a11yRed' : 'passport.banner.a11yOrange', {
            title,
          })}
        >
          {red ? <AlertIcon color={fg} size={20} /> : <WarningIcon color={fg} size={20} />}
          <Text style={[styles.bodyStrong, styles.grow, { color: fg }]}>{title}</Text>
        </View>
        <Text style={[styles.callout, { color: p.textPrimary }]}>{body}</Text>
        {list.map((h) => (
          <Pressable
            key={h.id}
            accessibilityRole="button"
            accessibilityLabel={t('passport.banner.rowA11y', {
              name: nameOf(h),
              date: formatDate(h.expiry!, t),
            })}
            accessibilityHint={t('passport.banner.rowHint')}
            onPress={() => setOpen({ holder: h })}
            style={({ pressed }) => [
              styles.bannerRow,
              { backgroundColor: pressed ? p.pressed : p.surface },
            ]}
            testID={`card-passport-row-${h.isMe ? 'me' : h.id}`}
          >
            <Text style={[styles.callout, styles.grow, { color: p.textPrimary }]}>
              {t('passport.banner.row', { name: nameOf(h), date: isolateLtr(numDate(h.expiry!)) })}
            </Text>
            <ChevronEndIcon color={p.textTertiary} />
          </Pressable>
        ))}
      </View>
    );
  };

  const missing = dismissed === false ? result.missing : [];
  const onlyMe = missing.length === 1 && missing[0]!.isMe;
  const names = missing.map((m) => (m.isMe ? t('passport.me') : isolateOwn(m.name)));

  return (
    <>
      {banner('red', result.red)}
      {banner('orange', result.orange)}
      {missing.length ? (
        <View
          style={[styles.reminder, { backgroundColor: p.infoBg }]}
          testID="card-passport-reminder"
        >
          <Text style={[styles.callout, { color: p.infoFg }]}>
            {onlyMe
              ? t('passport.reminder.titleMine')
              : t('passport.reminder.titleOf', { names: names.join(', ') })}
          </Text>
          <Text style={[styles.callout, { color: p.infoFg }]}>{t('passport.reminder.body')}</Text>
          <View style={styles.actions}>
            <Button
              kind="secondary"
              label={t('passport.reminder.add')}
              onPress={() => {
                const m = missing.length === 1 ? missing[0]! : null;
                setOpen(
                  !m
                    ? 'list'
                    : m.holder
                      ? { holder: m.holder }
                      : m.isMe
                        ? { me: true }
                        : { newName: m.name },
                );
              }}
              colorScheme={colorScheme}
              testID="card-passport-reminder-add"
            />
            <Button
              kind="text"
              label={t('passport.reminder.later')}
              onPress={() => {
                setDismissed(true);
                void dismissReminder(trip.id);
              }}
              colorScheme={colorScheme}
              testID="card-passport-reminder-later"
            />
          </View>
        </View>
      ) : null}
      {open ? (
        <PassportsScreen
          suggestions={[]}
          open={open === 'list' ? undefined : open}
          colorScheme={colorScheme}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onToast={onToast}
          onBack={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: radius.md, padding: 12, gap: 8, borderStartWidth: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  bannerRow: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reminder: { borderRadius: radius.md, padding: 12, gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, textAlign: 'left' },
});
