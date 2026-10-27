/**
 * Sprint 7 F-019 (design 2-5, 7): a route's header, the layover row between
 * two legs, the transit warning and the "same booking?" sheet. The rules are
 * in connections.ts; these only show them.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { HourglassIcon, NextIcon, NoEntryIcon, WarningIcon } from '@/components/icons';
import { EntryTag } from '@/features/destination/DestinationFields';
import type { Advisory, EntryStatus } from '@/features/destination/destinationData';
import { countryByAdm0 } from '@/features/globe/countryData';
import { isolateLtr } from '@/features/globe/BoardingPassCard';
import { countryName } from '@/features/trips/countryName';
import { colors, fonts, radius, type ColorScheme } from '@/theme/tokens';

import type { Airport } from './airportsData';
import { layover, sameBooking, type Layover, type LayoverStatus } from './connections';
import type { Direction, Flight } from './flightModel';
import { setSameBooking } from './flightsApi';
import { spellCode } from './flightTime';

type T = ReturnType<typeof useTranslation>['t'];

/** Design 3.3: "40 דק'" under an hour, "2:10" from it (never "0:40"). */
export function waitText(minutes: number, t: T): string {
  if (minutes < 60) return t('layover.minutes', { n: minutes });
  const h = Math.floor(minutes / 60);
  return isolateLtr(`${h}:${String(minutes % 60).padStart(2, '0')}`);
}

/** The wait in words for TalkBack (design 3.3, 11.1). */
export function waitA11y(minutes: number, t: T): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const mins = m === 1 ? t('layover.a11y.minuteOne') : t('layover.a11y.minutes', { n: m });
  if (h === 0) return mins;
  const hours =
    h === 1
      ? t('layover.a11y.hourOne')
      : h === 2
        ? t('layover.a11y.hourTwo')
        : t('layover.a11y.hours', { n: h });
  return m === 0 ? hours : t('layover.a11y.join', { h: hours, m: mins });
}

/** Design 11.1: what TalkBack says for a layover, in the card, the sheet and the form. */
export function layoverLabel(l: Layover, where: string, nextNo: string, t: T): string {
  const chip = l.status === 'ok' || l.status === 'short' || l.status === 'risky' ? l.status : null;
  if (l.status === 'invalid') {
    return `${t('layover.a11y.connectionAt', { where })}. ${t('layover.invalid')}`;
  }
  if (l.status === 'missed') {
    return `${t('layover.a11y.connectionAt', { where })}. ${t('layover.missed')}, ${spellCode(nextNo)}. ${t('layover.status.risky')}.`;
  }
  if (l.minutes === null) return t('layover.a11y.connectionAt', { where });
  const status =
    l.status === 'risky' && l.mct
      ? ` ${t('layover.a11y.risky', { time: waitA11y(l.mct, t) })}.`
      : chip
        ? ` ${t(`layover.status.${chip}`)}.`
        : '';
  return `${t('layover.wait', { time: waitA11y(l.minutes, t), apt: where })}.${status}`;
}

export interface TransitWarning {
  status: Extract<EntryStatus, 'restricted' | 'banned'>;
  adm0: string;
  apt: string;
  sourceUrl: string | null;
}

/**
 * Design 5.1: only restricted or banned; nothing when unknown, allowed, not
 * loaded, in Israel, or in the trip's own country (Raz design q8).
 */
export function transitWarning(
  iata: string | null,
  airports: Airport[] | null,
  advisories: Map<string, Advisory> | null,
  tripAdm0: string,
): TransitWarning | null {
  if (!iata || !airports || !advisories) return null;
  const airport = airports.find((a) => a.iata === iata);
  if (!airport || airport.adm0 === 'ISR' || airport.adm0 === tripAdm0) return null;
  const advisory = advisories.get(airport.adm0);
  const status = advisory?.entryStatus;
  if (status !== 'restricted' && status !== 'banned') return null;
  return { status, adm0: airport.adm0, apt: iata, sourceUrl: advisory?.entrySourceUrl ?? null };
}

const CHIP: Record<'ok' | 'short' | 'risky', 'success' | 'info' | 'alert'> = {
  ok: 'success',
  short: 'info',
  risky: 'alert',
};

export function StatusChip({
  status,
  colorScheme,
  testID,
}: {
  status: 'ok' | 'short' | 'risky';
  colorScheme: ColorScheme;
  testID: string;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const kind = CHIP[status];
  const [bg, fg] =
    kind === 'success'
      ? [p.successSubtleBg, p.successSubtleFg]
      : kind === 'info'
        ? [p.infoBg, p.infoFg]
        : [p.entryRestrictedBg, p.entryRestrictedFg];
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: bg },
        colorScheme === 'dark' &&
          kind !== 'success' && { borderWidth: 1, borderColor: p.borderControl },
      ]}
      importantForAccessibility="no"
      testID={testID}
    >
      {kind === 'alert' ? <WarningIcon color={fg} size={12} /> : null}
      <Text style={[styles.caption, { color: fg }]}>{t(`layover.status.${status}`)}</Text>
    </View>
  );
}

/** Design 2.2: "הלוך · TLV ‹ IST ‹ BKK". */
export function RouteHeader({
  legs,
  direction,
  colorScheme,
  testID,
}: {
  legs: Flight[];
  direction: Direction;
  colorScheme: ColorScheme;
  testID: string;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const codes = [legs[0]!.depIata, ...legs.map((l) => l.arrIata ?? '—')];
  return (
    <View
      style={styles.routeHeader}
      accessible
      accessibilityRole="header"
      accessibilityLabel={t('route.a11y', {
        direction: t(`flight.dir.${direction}`),
        codes: codes.map(spellCode).join(', '),
        n: legs.length,
      })}
      testID={testID}
    >
      <Text style={[styles.caption, { color: p.textSecondary }]}>
        {t('route.header', { direction: t(`flight.dir.${direction}`) })}
      </Text>
      {codes.map((c, i) => (
        <View key={`${c}-${i}`} style={styles.routeCode}>
          {i > 0 ? <NextIcon color={p.textTertiary} size={12} /> : null}
          <Text style={[styles.code, { color: p.textPrimary }]} maxFontSizeMultiplier={2}>
            {isolateLtr(c)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Design 5.2: the entry tag, where, the sentence and the source. */
export function TransitNotice({
  warning,
  colorScheme,
  testID,
}: {
  warning: TransitWarning;
  colorScheme: ColorScheme;
  testID: string;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const country = countryByAdm0(warning.adm0);
  const place = t('transit.place', {
    country: country ? countryName(country, i18n.language) : warning.adm0,
    apt: isolateLtr(warning.apt),
  });
  const sentence = t(`transit.${warning.status}`);
  return (
    <View style={styles.gap4} testID={testID} accessibilityValue={{ text: warning.status }}>
      <View
        accessible
        accessibilityLabel={`${t(`entry.${warning.status}A11y`)}, ${place}. ${sentence}`}
        style={styles.gap4}
      >
        <View style={styles.wrapRow} importantForAccessibility="no-hide-descendants">
          <EntryTag status={warning.status} colorScheme={colorScheme} />
          <Text style={[styles.footnote, { color: p.textSecondary }]}>{place}</Text>
        </View>
        <Text
          style={[styles.callout, { color: p.textPrimary }]}
          importantForAccessibility="no"
          maxFontSizeMultiplier={2}
        >
          {sentence}
        </Text>
      </View>
      {warning.sourceUrl ? (
        <Pressable
          accessibilityRole="link"
          accessibilityHint={t('transit.sourceHint')}
          onPress={() => void Linking.openURL(warning.sourceUrl!)}
          style={styles.link}
          testID={`${testID}-source`}
        >
          <Text style={[styles.footnote, { color: p.link }]}>{t('entry.sourceLink')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const BOOKING = { true: 'yes', false: 'no', null: 'unknown' } as const;

/** Design 3: the layover between two legs; in the sheet with "from A to B" (design 7). */
export function LayoverRow({
  prev,
  next,
  now,
  tripAdm0,
  airports,
  advisories,
  offline,
  context = false,
  colorScheme,
  onChange,
  onBlocked,
  testID,
}: {
  prev: Flight;
  next: Flight;
  now: Date;
  tripAdm0: string;
  airports: Airport[] | null;
  advisories: Map<string, Advisory> | null;
  offline: boolean;
  /** The flight sheet: says which connection this is. */
  context?: boolean;
  colorScheme: ColorScheme;
  onChange: () => void;
  onBlocked: () => void;
  testID: string;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const l = layover(prev, next, now);
  const apt = prev.arrIata ?? next.depIata;
  const airport = airports?.find((a) => a.iata === apt);
  const city = airport ? (i18n.language === 'he' ? airport.cityHe : airport.cityEn) : null;
  const where = city
    ? t('layover.a11y.where', { apt: spellCode(apt), city })
    : t('layover.a11y.where', { apt: spellCode(apt), city: '' }).replace(/,\s*$/, '');
  const answer = sameBooking(next, prev.id);
  const booking = BOOKING[String(answer) as 'true' | 'false' | 'null'];
  const transit = transitWarning(apt, airports, advisories, tripAdm0);
  const prevNo = prev.numberInput || prev.number;
  const nextNo = next.numberInput || next.number;

  const alert = l.status === 'missed' || l.status === 'invalid';
  const line1 =
    l.status === 'invalid'
      ? t('layover.invalid')
      : l.status === 'missed'
        ? t('layover.missed')
        : l.minutes !== null
          ? t('layover.wait', { time: waitText(l.minutes, t), apt: isolateLtr(apt) })
          : t('layover.wait', { time: '—', apt: isolateLtr(apt) });
  const chip: 'ok' | 'short' | 'risky' | null =
    l.status === 'ok' || l.status === 'short' || l.status === 'risky'
      ? l.status
      : l.status === 'missed'
        ? 'risky'
        : null;
  const a11y = layoverLabel(l, where, nextNo, t);

  return (
    <View style={[styles.layover, { borderStartColor: p.borderControl }]}>
      <View style={[styles.layoverIcon, { backgroundColor: p.openRow }]}>
        {l.status === 'invalid' ? (
          <NoEntryIcon color={p.textAlert} size={16} />
        ) : (
          <HourglassIcon color={p.textSecondary} />
        )}
      </View>
      <View style={styles.layoverBody}>
        <View
          accessible
          accessibilityLabel={a11y}
          accessibilityValue={{ text: l.status }}
          style={styles.gap4}
          testID={testID}
        >
          {context ? (
            <Text style={[styles.footnote, { color: p.textSecondary }]}>
              {t('layover.context', { prev: isolateLtr(prevNo), next: isolateLtr(nextNo) })}
            </Text>
          ) : null}
          <View style={styles.wrapRow}>
            <Text
              style={[
                styles.callout,
                alert ? { color: p.textAlert, fontFamily: fonts.medium } : { color: p.textPrimary },
              ]}
              maxFontSizeMultiplier={2}
              testID={`${testID}-wait`}
            >
              {line1}
            </Text>
            {chip ? (
              <StatusChip
                status={chip}
                colorScheme={colorScheme}
                testID={`${testID}-chip-${chip}`}
              />
            ) : null}
          </View>
          {(l.status === 'short' || l.status === 'risky') && l.mct ? (
            <Text
              style={[styles.footnote, { color: p.textSecondary }]}
              maxFontSizeMultiplier={2}
              testID={`${testID}-mct`}
            >
              {prev.arrMctDefault
                ? t('layover.mctDefault', { min: l.mct })
                : t('layover.mct', { min: l.mct, apt: isolateLtr(apt) })}
            </Text>
          ) : null}
        </View>
        <View style={styles.bookingRow}>
          <Text
            style={[
              styles.footnote,
              booking === 'no'
                ? { color: p.textPrimary, fontFamily: fonts.medium }
                : { color: p.textSecondary },
            ]}
            accessibilityValue={{ text: booking }}
            maxFontSizeMultiplier={2}
            testID={`${testID}-booking`}
          >
            {t(`layover.booking.${booking}`)}
          </Text>
          <Button
            kind="text"
            label={t('layover.booking.change')}
            a11yLabel={t('layover.booking.changeA11y', {
              prev: spellCode(prevNo),
              next: spellCode(nextNo),
            })}
            a11yHint={offline ? t('offline.readOnlyHint') : t('layover.booking.changeHint')}
            blocked={offline}
            onPress={offline ? onBlocked : onChange}
            colorScheme={colorScheme}
            testID={`${testID}-booking-change`}
          />
        </View>
        {booking === 'no' ? (
          <InlineNotice
            text={t('layover.separate', { prev: isolateLtr(prevNo), next: isolateLtr(nextNo) })}
            colorScheme={colorScheme}
            testID={`${testID}-separate`}
          />
        ) : null}
        {transit ? (
          <TransitNotice warning={transit} colorScheme={colorScheme} testID={`${testID}-transit`} />
        ) : null}
      </View>
    </View>
  );
}

/** Design 4.1: the answer, saved on a tap; never optimistic. */
export function SameBookingSheet({
  prev,
  next,
  visible,
  colorScheme,
  reduceMotion,
  insetsBottom,
  onClose,
  onSaved,
  onGone,
}: {
  prev: Flight | null;
  next: Flight | null;
  visible: boolean;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsBottom: number;
  onClose: () => void;
  onSaved: () => void;
  onGone: () => void;
}) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const [busy, setBusy] = useState<boolean | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const saving = useRef(false);
  const current = prev && next ? sameBooking(next, prev.id) : null;

  const choose = async (value: boolean | null) => {
    if (!prev || !next || saving.current) return;
    if (value === current) {
      onClose();
      return;
    }
    saving.current = true;
    setNotice(null);
    setBusy(value);
    const result = await setSameBooking(next.id, prev.id, value);
    saving.current = false;
    setBusy(undefined);
    if (result === 'ok') {
      AccessibilityInfo.announceForAccessibility(
        t(
          value === true
            ? 'sameBooking.savedYes'
            : value === false
              ? 'sameBooking.savedNo'
              : 'sameBooking.savedUnknown',
        ),
      );
      onSaved();
    } else if (result === 'gone') {
      onGone();
    } else {
      setNotice(t(result === 'offline' ? 'sameBooking.offline' : 'sameBooking.error'));
    }
  };

  const rows: { value: boolean | null; key: 'yes' | 'no' | 'unknown' }[] = [
    { value: true, key: 'yes' },
    { value: false, key: 'no' },
    { value: null, key: 'unknown' },
  ];
  const otherNo = prev ? prev.numberInput || prev.number : '';

  return (
    <BottomSheet
      visible={visible}
      colorScheme={colorScheme}
      reduceMotion={reduceMotion}
      insetsBottom={insetsBottom}
      onClose={() => !saving.current && onClose()}
      onBack={() => !saving.current && onClose()}
      testID="same-booking-sheet"
    >
      <View style={styles.sheetBody}>
        <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
          {t('sameBooking.question', { other: isolateLtr(otherNo) })}
        </Text>
        <Text style={[styles.body, { color: p.textSecondary }]}>{t('sameBooking.body')}</Text>
        {notice ? (
          <InlineNotice text={notice} colorScheme={colorScheme} testID="same-booking-notice" />
        ) : null}
        <View accessibilityRole="radiogroup">
          {rows.map(({ value, key }) => {
            // "Not sure" and unanswered are one state: no row marked (Raz design 5).
            const checked = value !== null && current === value;
            const isBusy = busy === value;
            return (
              <Pressable
                key={key}
                accessibilityRole="radio"
                accessibilityState={{ checked, busy: isBusy, disabled: busy !== undefined }}
                disabled={busy !== undefined}
                onPress={() => void choose(value)}
                style={({ pressed }) => [
                  styles.radioRow,
                  pressed && { backgroundColor: p.pressed },
                ]}
                testID={`same-booking-${key}`}
              >
                {isBusy ? (
                  <ActivityIndicator size={20} color={p.textSecondary} />
                ) : (
                  <View
                    style={[styles.radio, { borderColor: checked ? p.primary : p.borderControl }]}
                  >
                    {checked ? (
                      <View style={[styles.radioDot, { backgroundColor: p.primary }]} />
                    ) : null}
                  </View>
                )}
                <Text style={[styles.body, { color: p.textPrimary }]}>
                  {t(`sameBooking.${key}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </BottomSheet>
  );
}

export type { LayoverStatus };

const styles = StyleSheet.create({
  routeHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  routeCode: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  layover: {
    borderStartWidth: 2,
    borderStyle: 'dashed',
    marginStart: 19,
    paddingVertical: 8,
    paddingEnd: 12,
    minHeight: 48,
    flexDirection: 'row',
  },
  layoverIcon: { marginStart: -9, width: 16, height: 16, marginTop: 2 },
  layoverBody: { flex: 1, gap: 4, paddingStart: 13 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  bookingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  gap4: { gap: 4 },
  link: { minHeight: 48, justifyContent: 'center', marginVertical: -12, alignSelf: 'flex-start' },
  sheetBody: { gap: 12, marginTop: 8 },
  radioRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 16 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textAlign: 'left' },
  callout: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  title2: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, textAlign: 'left' },
  code: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, letterSpacing: 1.6 },
});
