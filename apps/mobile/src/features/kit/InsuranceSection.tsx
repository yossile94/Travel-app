/**
 * Sprint 8 design 8, 10: "Insurance" in an open trip row (AC-7 to AC-10).
 * One policy per trip; the hotline dials from the row, the hotel sheet and
 * the SOS screen, and without one the row asks for it (AC-8). The policy
 * document is attached in the sheet, stored encrypted on this device only.
 */
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import {
  FileIcon,
  PencilIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
  WarningIcon,
} from '@/components/icons';
import { countryByAdm0 } from '@/features/globe/countryData';
import { isolateLtr, isolateOwn } from '@/features/globe/BoardingPassCard';
import { useReduceMotion } from '@/features/globe/useReduceMotion';
import { countryName } from '@/features/trips/countryName';
import { formatDate, todayPg } from '@/features/trips/tripDates';
import { colors, type ColorScheme } from '@/theme/tokens';

import { countryWords } from './hebrewPrefix';
import type { KitTrip } from './HotelScreen';
import { InsuranceScreen } from './InsuranceScreen';
import { syncInsuranceReminder, type ReminderText } from './insuranceReminder';
import { deleteInsurance } from './kitApi';
import { endsEarly, type Insurance, numDate } from './kitModel';
import { refreshTripKit } from './kitStore';
import { DialRow, SecretRow, SectionTitle, styles } from './kitUi';
import {
  clearViews,
  openPolicy,
  policyMeta,
  removePolicy,
  savePolicy,
  type PolicyMeta,
} from './policyFile';

/** The reminder's words for a trip, in the language of the moment (design 11.1). */
export function reminderText(
  t: (k: string, o?: Record<string, unknown>) => string,
  language: string,
  countryAdm0: string,
): ReminderText {
  const country = countryByAdm0(countryAdm0);
  const words = countryWords(country ? countryName(country, language) : countryAdm0, language);
  // Design 11.1 (sprint 6 3.1): an RLM leads Hebrew titles, so a country in Latin script stays in place.
  const rlm = language === 'he' ? String.fromCharCode(0x200f) : '';
  return {
    title: rlm + t('reminder.insurance.title', words),
    body: rlm + t('reminder.insurance.body'),
    channel: { name: t('channel.reminders.name'), description: t('channel.reminders.description') },
  };
}

/** After 5 s of saving a file, the percentage shows (design 10.2). */
const PROGRESS_AFTER_MS = 5000;

function PolicyFile({ tripId, colorScheme }: { tripId: string; colorScheme: ColorScheme }) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  const [meta, setMeta] = useState<PolicyMeta | null>(() => policyMeta(tripId));
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The decrypted viewing copy goes when the app comes back (design 10.2).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      clearViews();
      setMeta(policyMeta(tripId));
    });
    return () => sub.remove();
  }, [tripId]);

  const attach = async () => {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setSaving(0);
    setSlow(false);
    slowTimer.current = setTimeout(() => setSlow(true), PROGRESS_AFTER_MS);
    const result = await savePolicy(tripId, asset, todayPg(), (f) => setSaving(f));
    clearTimeout(slowTimer.current);
    setSaving(null);
    if (result === 'ok') {
      setMeta(policyMeta(tripId));
      AccessibilityInfo.announceForAccessibility(t('policyFile.saved'));
    } else
      setError(
        t(
          result === 'tooBig'
            ? 'policyFile.err.tooBig'
            : result === 'type'
              ? 'policyFile.err.type'
              : 'policyFile.err.save',
        ),
      );
  };

  const open = async () => {
    setError(null);
    const result = await openPolicy(tripId);
    if (result === 'missing') {
      setMeta(null);
      setError(t('policyFile.err.missing'));
    } else if (result === 'noViewer') setError(t('policyFile.err.noViewer'));
    else if (result === 'error') setError(t('policyFile.err.open'));
  };

  const busyLabel =
    saving !== null && slow
      ? t('policyFile.savingProgress', { n: Math.round(saving * 100) })
      : t('policyFile.saving');

  return (
    <View style={styles.gap8} testID="policy-file">
      <Text style={[styles.title3, { color: p.textPrimary }]} accessibilityRole="header">
        {t('policyFile.title')}
      </Text>
      {error ? (
        <InlineNotice text={error} colorScheme={colorScheme} testID="policy-file-error" />
      ) : null}
      {meta ? (
        <>
          <View style={styles.rowLine}>
            <FileIcon color={p.textSecondary} />
            <View style={styles.grow}>
              <Text style={[styles.footnote, { color: p.textPrimary }]}>
                {t('policyFile.meta', {
                  kind: t(meta.kind === 'pdf' ? 'policyFile.kindPdf' : 'policyFile.kindImage'),
                  size: t('policyFile.size', { n: (meta.size / 1024 / 1024).toFixed(1) }),
                  date: isolateLtr(numDate(meta.addedAt)),
                })}
              </Text>
              <Text style={[styles.footnote, { color: p.textSecondary }]}>
                {t('policyFile.thisDevice')}
              </Text>
            </View>
            {Platform.OS === 'android' ? (
              <Button
                kind="text"
                label={t('policyFile.open')}
                a11yLabel={t('policyFile.openA11y')}
                a11yHint={t('policyFile.openHint')}
                onPress={() => void open()}
                colorScheme={colorScheme}
                testID="policy-file-open"
              />
            ) : null}
          </View>
          <View style={styles.actions}>
            <Button
              kind="text"
              label={t('policyFile.replace')}
              busy={saving !== null}
              busyLabel={busyLabel}
              onPress={() => void attach()}
              colorScheme={colorScheme}
              testID="policy-file-replace"
            />
            <Button
              kind="text"
              label={t('policyFile.remove')}
              disabled={saving !== null}
              onPress={() =>
                Alert.alert(t('policyFile.removeTitle'), t('policyFile.removeBody'), [
                  { text: t('flight.cancel'), style: 'cancel' },
                  {
                    text: t('policyFile.remove'),
                    style: 'destructive',
                    onPress: () => {
                      removePolicy(tripId);
                      setMeta(null);
                    },
                  },
                ])
              }
              colorScheme={colorScheme}
              testID="policy-file-remove"
            />
          </View>
        </>
      ) : (
        <>
          <Button
            kind="secondary"
            outlined={colorScheme === 'dark'}
            label={t('policyFile.attach')}
            icon={(c) => <FileIcon color={c} size={20} />}
            busy={saving !== null}
            busyLabel={busyLabel}
            onPress={() => void attach()}
            colorScheme={colorScheme}
            testID="policy-file-attach"
          />
          <Text style={[styles.footnote, { color: p.textSecondary }]}>{t('policyFile.help')}</Text>
        </>
      )}
    </View>
  );
}

function EndsEarlyChip({ colorScheme }: { colorScheme: ColorScheme }) {
  const { t } = useTranslation();
  const p = colors[colorScheme];
  return (
    <View
      style={[styles.chip, { backgroundColor: p.entryRestrictedBg }]}
      testID="card-insurance-ends-early"
    >
      <WarningIcon color={p.entryRestrictedFg} size={12} />
      <Text style={[styles.chipText, { color: p.entryRestrictedFg }]}>
        {t('insurance.endsEarly')}
      </Text>
    </View>
  );
}

export function InsuranceSection({
  trip,
  insurance,
  status,
  offline,
  colorScheme,
  onToast,
}: {
  trip: KitTrip;
  insurance: Insurance | null;
  status: 'loading' | 'ready' | 'error';
  offline: boolean;
  colorScheme: ColorScheme;
  onToast: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const p = colors[colorScheme];
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion() ?? false;
  const [screen, setScreen] = useState<{ focusHotline: boolean } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const guard = (action: () => void) => () => (offline ? setBlocked(true) : action());
  // Read once, and again when the sheet closes: not a file check on every render (Raz review 8).
  const [hasFile, setHasFile] = useState(() => policyMeta(trip.id) !== null);
  const early = insurance ? endsEarly(insurance.validUntil, trip.endDate) : false;

  const remove = () =>
    Alert.alert(t('insurance.deleteTitle'), t('insurance.deleteBody'), [
      { text: t('flight.cancel'), style: 'cancel' },
      {
        text: t('hotel.deleteConfirm'),
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setBusy(true);
            const result = await deleteInsurance(trip.id);
            setBusy(false);
            if (result === 'ok' || result === 'gone') {
              // AC-9: the file goes with it; AC-10: the reminder may come back.
              removePolicy(trip.id);
              setHasFile(false);
              void syncInsuranceReminder(
                trip,
                false,
                reminderText(t, i18n.language, trip.countryAdm0),
              );
              setSheet(false);
              onToast(t('insurance.deleted'));
              void refreshTripKit(trip.id);
            } else if (result === 'offline') onToast(t('hotel.deleteOffline'));
            else onToast(t('insurance.saveError'));
          })(),
      },
    ]);

  const untilText = insurance?.validUntil
    ? t('insurance.validUntil', { date: isolateLtr(numDate(insurance.validUntil)) })
    : null;

  return (
    <View style={styles.section} testID="card-insurance">
      <SectionTitle text={t('insurance.title')} colorScheme={colorScheme} />
      {insurance ? (
        <View
          style={[
            styles.card,
            { backgroundColor: p.surface },
            colorScheme === 'dark' && { borderWidth: 1, borderColor: p.borderSubtle },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('insurance.rowA11y', {
              company: insurance.provider,
              until: untilText ? `, ${untilText}` : '',
              warn: early
                ? `, ${t('insurance.endsEarlyA11y', { date: formatDate(insurance.validUntil!, t), end: formatDate(trip.endDate, t) })}`
                : '',
            })}
            accessibilityHint={t('insurance.rowHint')}
            onPress={() => setSheet(true)}
            style={styles.gap4}
            testID="card-insurance-row"
          >
            <View style={styles.rowLine}>
              <ShieldIcon color={p.textSecondary} size={20} />
              <Text style={[styles.bodyStrong, styles.grow, { color: p.textPrimary }]}>
                {isolateOwn(insurance.provider)}
              </Text>
            </View>
            {untilText || early ? (
              <View style={[styles.rowLine, { flexWrap: 'wrap' }]}>
                {untilText ? (
                  <Text style={[styles.footnote, { color: p.textSecondary }]}>{untilText}</Text>
                ) : null}
                {early ? <EndsEarlyChip colorScheme={colorScheme} /> : null}
              </View>
            ) : null}
            {hasFile ? (
              <Text style={[styles.footnote, { color: p.textSecondary }]}>
                {t('insurance.fileOnDevice')}
              </Text>
            ) : null}
          </Pressable>
          {insurance.emergencyPhone ? (
            <DialRow
              label={t('insurance.call')}
              number={insurance.emergencyPhone}
              colorScheme={colorScheme}
              testID="card-insurance-dial"
            />
          ) : (
            <Button
              kind="link"
              label={t('insurance.noHotline')}
              icon={(c) => <PlusIcon color={c} size={20} />}
              blocked={offline}
              onPress={guard(() => setScreen({ focusHotline: true }))}
              colorScheme={colorScheme}
              testID="card-insurance-no-hotline"
            />
          )}
        </View>
      ) : status === 'loading' ? null : status === 'error' ? (
        // Not known: "add" could overwrite a policy that wasn't read (Raz review 6).
        <View style={styles.rowLine}>
          <Text
            style={[styles.footnote, styles.grow, { color: p.textSecondary }]}
            testID="card-insurance-error"
          >
            {t('insurance.loadError')}
          </Text>
          <Button
            kind="text"
            label={t('flights.retry')}
            onPress={() => void refreshTripKit(trip.id)}
            colorScheme={colorScheme}
            testID="card-insurance-retry"
          />
        </View>
      ) : (
        <>
          <Button
            kind="link"
            label={t('insurance.add')}
            icon={(c) => <PlusIcon color={c} size={20} />}
            blocked={offline}
            onPress={guard(() => setScreen({ focusHotline: false }))}
            colorScheme={colorScheme}
            testID="card-insurance-add"
          />
          <Text
            style={[styles.footnote, { color: p.textSecondary }]}
            testID="card-insurance-empty-help"
          >
            {t('insurance.emptyHelp')}
          </Text>
        </>
      )}
      {blocked ? (
        <InlineNotice
          text={t('offline.readOnly')}
          colorScheme={colorScheme}
          testID="card-insurance-readonly"
        />
      ) : null}

      {screen ? (
        <InsuranceScreen
          trip={trip}
          insurance={insurance}
          focusHotline={screen.focusHotline}
          colorScheme={colorScheme}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          onClose={() => setScreen(null)}
          onSaved={() => {
            setScreen(null);
            // AC-10: insured now, so no reminder.
            void syncInsuranceReminder(
              trip,
              true,
              reminderText(t, i18n.language, trip.countryAdm0),
            );
            onToast(t('insurance.saved'));
            void refreshTripKit(trip.id);
          }}
        />
      ) : null}
      <BottomSheet
        visible={sheet && insurance !== null}
        colorScheme={colorScheme}
        reduceMotion={reduceMotion}
        insetsBottom={insets.bottom}
        onClose={() => {
          setSheet(false);
          // The decrypted viewing copy goes with the sheet too (Raz re-review 2).
          clearViews();
          setHasFile(policyMeta(trip.id) !== null);
        }}
        maxHeight={640}
        testID="insurance-sheet"
      >
        {insurance ? (
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text style={[styles.title2, { color: p.textPrimary }]} accessibilityRole="header">
              {isolateOwn(insurance.provider)}
            </Text>
            {untilText || early ? (
              <View style={[styles.rowLine, { flexWrap: 'wrap' }]}>
                {untilText ? (
                  <Text style={[styles.footnote, { color: p.textSecondary }]}>{untilText}</Text>
                ) : null}
                {early ? <EndsEarlyChip colorScheme={colorScheme} /> : null}
              </View>
            ) : null}
            {insurance.emergencyPhone ? (
              <DialRow
                label={t('insurance.call')}
                number={insurance.emergencyPhone}
                colorScheme={colorScheme}
                testID="insurance-sheet-dial"
              />
            ) : null}
            {insurance.policyNumber ? (
              <SecretRow
                label={t('insurance.policyLabel')}
                hiddenA11y={t('insurance.policyHidden')}
                showLabel={t('insurance.policyShow')}
                hideLabel={t('insurance.policyHide')}
                value={insurance.policyNumber}
                colorScheme={colorScheme}
                testID="insurance-sheet-policy"
              />
            ) : null}
            {insurance.notes ? (
              <View style={styles.gap4}>
                <SectionTitle text={t('insurance.notesLabel')} colorScheme={colorScheme} />
                <Text style={[styles.body, { color: p.textPrimary }]}>{insurance.notes}</Text>
              </View>
            ) : null}
            <PolicyFile tripId={trip.id} colorScheme={colorScheme} />
            <View style={styles.actions}>
              <Button
                kind="secondary"
                outlined={colorScheme === 'dark'}
                label={t('hotel.edit')}
                icon={(c) => <PencilIcon color={c} size={20} />}
                blocked={offline}
                disabled={busy}
                onPress={guard(() => {
                  setSheet(false);
                  setScreen({ focusHotline: false });
                })}
                colorScheme={colorScheme}
                testID="insurance-sheet-edit"
              />
              <Button
                kind="text"
                label={t('hotel.delete')}
                icon={(c) => <TrashIcon color={c} size={20} />}
                blocked={offline}
                busy={busy}
                onPress={guard(remove)}
                colorScheme={colorScheme}
                testID="insurance-sheet-delete"
              />
            </View>
            {blocked ? (
              <InlineNotice text={t('offline.readOnly')} colorScheme={colorScheme} />
            ) : null}
          </ScrollView>
        ) : null}
      </BottomSheet>
    </View>
  );
}
