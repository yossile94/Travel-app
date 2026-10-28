/**
 * The signed-in account sheet (sprint 2 design 8, AC-11): who I am, my
 * consents, my data, account deletion and sign-out. The name is edited in
 * the sheet itself (8.2); "My consents" and deletion are pushed screens over
 * it (9, 11).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
} from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button, TextField, type ViewHandle } from '@/components/fields';
import { InlineNotice } from '@/components/formControls';
import { DownloadIcon, PencilIcon, ShieldIcon, TrashIcon } from '@/components/icons';
import { initialOf } from '@/features/auth/AccountButton';
import { useAuth, type AuthUser } from '@/features/auth/AuthProvider';
import { isolateLtr } from '@/features/globe/BoardingPassCard';
import { FlightAlertsRow } from '@/features/push/FlightAlertsRow';
import { unregisterDevice } from '@/features/push/push';
import { colors, fonts, layout, limits, radius, type ColorScheme } from '@/theme/tokens';

import { codePointLength } from '../trips/tripDates';
import { displayNameError } from './accountApi';
import { ConsentsScreen, DeleteAccountScreen, ListRow } from './AccountScreens';
import { exportMyData } from './exportData';

interface Props {
  visible: boolean;
  user: AuthUser;
  colorScheme: ColorScheme;
  reduceMotion: boolean;
  insetsTop: number;
  insetsBottom: number;
  onClose: () => void;
  onToast: (text: string) => void;
}

type Pushed = 'consents' | 'delete' | null;

export function AccountSheet({ visible, user, onToast, insetsTop, ...sheet }: Props) {
  const { t } = useTranslation();
  const { signOut, displayName, renameProfile } = useAuth();
  const palette = colors[sheet.colorScheme];
  const name = displayName ?? user.name;
  const shownUser = { ...user, name };
  const [editing, setEditing] = useState(false);
  /** While the name saves, back does nothing (design 8.2), so a failure is seen. */
  const nameSaving = useRef(false);
  const [pushed, setPushed] = useState<Pushed>(null);
  const [exporting, setExporting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const editButton = useRef<ViewHandle>(null);

  // Each opening starts on the main content; closing cancels an export (design 10.7).
  const [openedAs, setOpenedAs] = useState(visible);
  if (openedAs !== visible) {
    setOpenedAs(visible);
    if (!visible) {
      setEditing(false);
      setPushed(null);
      setExportNotice(null);
    }
  }
  useEffect(() => {
    if (!visible) exportAbort.current?.abort();
  }, [visible]);

  const runExport = async () => {
    setExportNotice(null);
    setExporting(true);
    AccessibilityInfo.announceForAccessibility(t('export.preparing'));
    const controller = new AbortController();
    exportAbort.current = controller;
    const result = await exportMyData(shownUser, t('export.dialogTitle'), controller.signal);
    if (exportAbort.current === controller) exportAbort.current = null;
    setExporting(false);
    if (result === 'offline') setExportNotice(t('export.offline'));
    else if (result === 'error') setExportNotice(t('export.error'));
  };

  const screen = {
    colorScheme: sheet.colorScheme,
    reduceMotion: sheet.reduceMotion,
    insetsTop,
    insetsBottom: sheet.insetsBottom,
  };

  return (
    <>
      <BottomSheet
        {...sheet}
        visible={visible}
        onBack={editing ? () => !nameSaving.current && setEditing(false) : undefined}
        testID="account-sheet"
      >
        {editing ? (
          <NameEditor
            initial={name ?? ''}
            colorScheme={sheet.colorScheme}
            onCancel={() => setEditing(false)}
            onSave={async (next) => {
              nameSaving.current = true;
              const result = await renameProfile(next).finally(() => {
                nameSaving.current = false;
              });
              if (result === 'ok') {
                setEditing(false);
                onToast(t('nameEdit.saved'));
                setTimeout(() => {
                  const node = findNodeHandle(editButton.current);
                  if (node) AccessibilityInfo.setAccessibilityFocus(node);
                }, 300);
              }
              return result;
            }}
          />
        ) : (
          <View>
            <View style={styles.head}>
              <View
                style={[styles.avatar, { backgroundColor: palette.primary }]}
                importantForAccessibility="no"
              >
                <Text style={[styles.avatarInitial, { color: palette.onPrimary }]}>
                  {initialOf(shownUser) ?? ''}
                </Text>
              </View>
              <View style={styles.headText}>
                <Pressable onPress={() => setEditing(true)} accessible={false}>
                  <Text
                    style={[styles.name, { color: palette.textPrimary }]}
                    accessibilityRole="header"
                  >
                    {name ?? ''}
                  </Text>
                </Pressable>
                {user.email ? (
                  <Text style={[styles.email, { color: palette.textSecondary }]}>
                    {isolateLtr(user.email)}
                  </Text>
                ) : null}
                <Text style={[styles.footnote, { color: palette.textTertiary }]}>
                  {t('account.connectedWithGoogle')}
                </Text>
              </View>
              <Pressable
                ref={editButton}
                accessibilityRole="button"
                accessibilityLabel={t('account.editName')}
                onPress={() => setEditing(true)}
                style={styles.editButton}
                testID="account-edit-name"
              >
                <PencilIcon color={palette.textSecondary} />
              </Pressable>
            </View>

            <View style={[styles.divider, { backgroundColor: palette.borderSubtle }]} />
            <FlightAlertsRow userId={user.id} visible={visible} colorScheme={sheet.colorScheme} />
            <ListRow
              icon={(color) => <ShieldIcon color={color} />}
              label={t('account.consents')}
              onPress={() => setPushed('consents')}
              colorScheme={sheet.colorScheme}
              testID="account-consents"
            />
            <ListRow
              icon={(color) => <DownloadIcon color={color} />}
              label={exporting ? t('export.preparing') : t('account.export')}
              description={t('account.exportSub')}
              chevron={false}
              busy={exporting}
              onPress={() => void runExport()}
              colorScheme={sheet.colorScheme}
              testID="account-export"
            />
            {exportNotice ? (
              <InlineNotice text={exportNotice} colorScheme={sheet.colorScheme} />
            ) : null}
            <ListRow
              icon={(color) => <TrashIcon color={color} />}
              label={t('account.delete')}
              onPress={() => setPushed('delete')}
              colorScheme={sheet.colorScheme}
              testID="account-delete"
            />
            <View style={[styles.divider, { backgroundColor: palette.borderSubtle }]} />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: signingOut, disabled: signingOut }}
              disabled={signingOut}
              onPress={() => {
                // Sprint 6 design 6.4: busy while this device leaves the alerts, 3 s at most.
                setSigningOut(true);
                void unregisterDevice().finally(() => {
                  setSigningOut(false);
                  sheet.onClose();
                  void signOut();
                });
              }}
              style={[styles.secondary, { backgroundColor: palette.secondaryBg }]}
              testID="sign-out"
            >
              <Text style={[styles.secondaryLabel, { color: palette.secondaryFg }]}>
                {signingOut ? t('account.signingOut') : t('account.signOut')}
              </Text>
            </Pressable>
          </View>
        )}
      </BottomSheet>

      {visible && pushed === 'consents' ? (
        <ConsentsScreen
          {...screen}
          user={user}
          onBack={() => setPushed(null)}
          onDeleteAccount={() => setPushed('delete')}
        />
      ) : null}
      {visible && pushed === 'delete' ? (
        <DeleteAccountScreen {...screen} user={user} onBack={() => setPushed(null)} />
      ) : null}
    </>
  );
}

/** Design 8.2: the sheet's content turns into the name field; "back" returns. */
function NameEditor({
  initial,
  colorScheme,
  onCancel,
  onSave,
}: {
  initial: string;
  colorScheme: ColorScheme;
  onCancel: () => void;
  onSave: (name: string) => Promise<'ok' | 'offline' | 'error'>;
}) {
  const { t } = useTranslation();
  const palette = colors[colorScheme];
  const [value, setValue] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const error = submitted ? displayNameError(value) : null;
  const length = codePointLength(value.trim());

  const save = async () => {
    if (saving) return;
    setSubmitted(true);
    if (displayNameError(value)) return;
    if (value.trim() === initial.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    setNotice(null);
    const result = await onSave(value);
    setSaving(false);
    if (result === 'offline') setNotice(t('nameEdit.offline'));
    else if (result === 'error') setNotice(t('nameEdit.error'));
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.editor}
    >
      <Text style={[styles.title2, { color: palette.textPrimary }]} accessibilityRole="header">
        {t('nameEdit.title')}
      </Text>
      {notice ? <InlineNotice text={notice} colorScheme={colorScheme} /> : null}
      <TextField
        label={t('nameEdit.label')}
        value={value}
        onChangeText={setValue}
        autoFocus
        editable={!saving}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        help={t('nameEdit.hint')}
        error={error ? t(error) : null}
        counter={
          length >= limits.profileNameCounterFrom
            ? t('tripForm.counter', { n: length, max: limits.profileNameMax })
            : null
        }
        maxLength={limits.profileNameMax * 2}
        colorScheme={colorScheme}
        testID="name-edit-field"
      />
      <Button
        kind="primary"
        label={t('nameEdit.save')}
        busy={saving}
        busyLabel={t('nameEdit.saving')}
        onPress={() => void save()}
        colorScheme={colorScheme}
        testID="name-edit-save"
      />
      <View style={styles.center}>
        <Button
          kind="text"
          label={t('nameEdit.cancel')}
          disabled={saving}
          onPress={onCancel}
          colorScheme={colorScheme}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8, paddingEnd: 40 },
  headText: { flex: 1, gap: 2 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  name: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24, textAlign: 'left' },
  email: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, textAlign: 'left' },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'left' },
  editButton: {
    width: layout.touchTargetMin,
    height: layout.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -8,
  },
  divider: { height: 1, marginVertical: 8 },
  secondary: {
    height: layout.touchTargetMin,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  secondaryLabel: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24 },
  editor: { gap: 16, marginTop: 8 },
  title2: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, textAlign: 'left' },
  center: { alignItems: 'center' },
});
