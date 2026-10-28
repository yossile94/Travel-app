/**
 * Sprint 8 design 9: adding or editing the trip's insurance (AC-7). One
 * policy per trip; a policy ending before the return warns but saves.
 */
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Alert } from 'react-native';

import { Button, DateField, TextField } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { useAuth } from '@/features/auth/AuthProvider';
import { isolateLtr, isolateOwn } from '@/features/globe/BoardingPassCard';
import { codePointLength, formatDate, fromPgDate, toPgDate } from '@/features/trips/tripDates';
import type { ColorScheme } from '@/theme/tokens';

import type { KitTrip } from './HotelScreen';
import { saveInsurance } from './kitApi';
import {
  endsEarly,
  insuranceErrors,
  insurancePayload,
  LIMITS,
  type HotelError,
  type Insurance,
  type InsuranceField,
  type InsuranceForm,
  numDate,
} from './kitModel';
import { alignFor } from './DriverCard';
import { FormShell } from './kitUi';

const FIELDS: readonly InsuranceField[] = ['provider', 'policyNumber', 'emergencyPhone', 'notes'];

const counter = (v: string, from: number, max: number) => {
  const n = codePointLength(v.trim());
  return n >= from ? `${n}/${max}` : undefined;
};

export function InsuranceScreen({
  trip,
  insurance,
  focusHotline = false,
  colorScheme,
  insetsTop,
  insetsBottom,
  onClose,
  onSaved,
}: {
  trip: KitTrip;
  insurance: Insurance | null;
  /** Design 8.3: opened from "add your insurer's hotline". */
  focusHotline?: boolean;
  colorScheme: ColorScheme;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { recheckConsent } = useAuth();
  const [initial] = useState<InsuranceForm>(() => ({
    provider: insurance?.provider ?? '',
    policyNumber: insurance?.policyNumber ?? '',
    validUntil: insurance?.validUntil ?? null,
    emergencyPhone: insurance?.emergencyPhone ?? '',
    notes: insurance?.notes ?? '',
  }));
  const [values, setValues] = useState(initial);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'offline' | 'error' | null>(null);
  const refs = useRef<Partial<Record<InsuranceField, { focus?: () => void } | null>>>({});

  const errors = tried ? insuranceErrors(values) : {};
  const text = (field: InsuranceField, e: HotelError | undefined): string | undefined => {
    if (!e) return undefined;
    if (e === 'phone') return t('phone.err');
    if (e === 'tooLong') {
      if (field === 'policyNumber') return t('insurance.err.policy');
      return t('form.err.tooLong', { max: field === 'notes' ? LIMITS.notes : LIMITS.provider });
    }
    return t('insurance.err.company');
  };
  const set = (patch: Partial<InsuranceForm>) => setValues((v) => ({ ...v, ...patch }));

  const changed = JSON.stringify(values) !== JSON.stringify(initial);
  const back = () => {
    if (busy) return;
    if (!changed) return onClose();
    Alert.alert(t('flight.discardTitle'), t('flight.discardBody'), [
      { text: t('flight.keep'), style: 'cancel' },
      { text: t('flight.discard'), style: 'destructive', onPress: onClose },
    ]);
  };

  const save = async () => {
    setTried(true);
    const found = insuranceErrors(values);
    const first = FIELDS.find((f) => found[f]);
    if (first) {
      refs.current[first]?.focus?.();
      AccessibilityInfo.announceForAccessibility(text(first, found[first]) ?? '');
      return;
    }
    setBusy(true);
    setNotice(null);
    let result = await saveInsurance(trip.id, insurancePayload(values));
    if (result === 'consent' && (await recheckConsent())) {
      result = await saveInsurance(trip.id, insurancePayload(values));
    }
    setBusy(false);
    if (result === 'ok') {
      AccessibilityInfo.announceForAccessibility(t('insurance.saved'));
      onSaved();
    } else if (result === 'gone') {
      Alert.alert(t('flight.tripGone'));
      onClose();
    } else if (result === 'offline') setNotice('offline');
    else if (result !== 'consent') setNotice('error');
  };

  const warn = endsEarly(values.validUntil, trip.endDate);

  return (
    <FormShell
      title={t(insurance ? 'insurance.titleEdit' : 'insurance.titleNew')}
      subtitle={isolateOwn(trip.title)}
      colorScheme={colorScheme}
      insetsTop={insetsTop}
      insetsBottom={insetsBottom}
      onBack={back}
      testID="insurance-screen"
      footer={
        <>
          {notice ? (
            <InlineNotice
              text={t(notice === 'offline' ? 'insurance.saveOffline' : 'insurance.saveError')}
              colorScheme={colorScheme}
              testID="insurance-notice"
            />
          ) : null}
          <Button
            kind="primary"
            label={t('insurance.save')}
            busy={busy}
            busyLabel={t('hotel.saving')}
            onPress={() => void save()}
            colorScheme={colorScheme}
            testID="insurance-save"
          />
        </>
      }
    >
      <TextField
        ref={(r) => void (refs.current.provider = r)}
        label={t('insurance.company')}
        value={values.provider}
        onChangeText={(provider) => set({ provider })}
        error={text('provider', errors.provider)}
        counter={counter(values.provider, 64, LIMITS.provider)}
        colorScheme={colorScheme}
        testID="insurance-company"
      />
      <TextField
        ref={(r) => void (refs.current.policyNumber = r)}
        label={t('insurance.policy')}
        help={t('insurance.policyPrivacy')}
        value={values.policyNumber}
        onChangeText={(policyNumber) => set({ policyNumber })}
        autoCorrect={false}
        style={{ textAlign: alignFor('ltr'), writingDirection: 'ltr' }}
        error={text('policyNumber', errors.policyNumber)}
        counter={counter(values.policyNumber, 32, LIMITS.ref)}
        colorScheme={colorScheme}
        testID="insurance-policy"
      />
      <DateField
        label={t('insurance.until')}
        value={values.validUntil ? isolateLtr(numDate(values.validUntil)) : null}
        placeholder="—"
        a11yLabel={`${t('insurance.until')}, ${values.validUntil ? formatDate(values.validUntil, t) : t('flight.noDataA11y')}`}
        a11yHint={t('tripForm.dateHint')}
        onPress={() =>
          DateTimePickerAndroid.open({
            mode: 'date',
            value: fromPgDate(values.validUntil ?? trip.endDate),
            positiveButton: { label: t('datePicker.ok') },
            negativeButton: { label: t('datePicker.cancel') },
            onValueChange: (_e, date) => set({ validUntil: toPgDate(date) }),
          })
        }
        colorScheme={colorScheme}
        testID="insurance-until"
      />
      {warn ? (
        <InlineNotice
          text={t('insurance.warn.endsEarly', {
            date: isolateLtr(numDate(values.validUntil!)),
            end: isolateLtr(numDate(trip.endDate)),
          })}
          colorScheme={colorScheme}
          testID="insurance-ends-early"
        />
      ) : null}
      <TextField
        ref={(r) => void (refs.current.emergencyPhone = r)}
        label={t('insurance.hotline')}
        help={t('insurance.hotlineHelp')}
        value={values.emergencyPhone}
        onChangeText={(emergencyPhone) => set({ emergencyPhone })}
        keyboardType="phone-pad"
        autoFocus={focusHotline}
        style={{ textAlign: alignFor('ltr'), writingDirection: 'ltr' }}
        error={text('emergencyPhone', errors.emergencyPhone)}
        colorScheme={colorScheme}
        testID="insurance-hotline"
      />
      <TextField
        ref={(r) => void (refs.current.notes = r)}
        label={t('insurance.notes')}
        help={t('insurance.notesHelp')}
        value={values.notes}
        onChangeText={(notes) => set({ notes })}
        multiline
        error={text('notes', errors.notes)}
        counter={counter(values.notes, 270, LIMITS.notes)}
        colorScheme={colorScheme}
        testID="insurance-notes"
      />
    </FormShell>
  );
}
