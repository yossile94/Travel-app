/**
 * Sprint 10 AC-5 (design 10.2): the decrypted photo, after authentication.
 * Screenshots blocked (SecureWindow, also hiding it in recent apps); no share,
 * no save, no long press. It closes by itself when the app leaves the
 * foreground, and the image lives only in memory (a data URI, never a file).
 */
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { ClearIcon, LockIcon } from '@/components/icons';
import { fonts } from '@/theme/tokens';

import { SecureWindow } from './vault';

const SPACE = '#03060F';
const FG = '#F3F6FC';
const MUTED = '#A3B3DB';

export function PhotoViewer({
  base64,
  label,
  insetsTop,
  onClose,
}: {
  base64: string;
  label: string;
  insetsTop: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && onClose());
    return () => sub.remove();
  }, [onClose]);
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <SecureWindow style={[styles.screen, { paddingTop: insetsTop }]} testID="passport-viewer">
        <StatusBar style="light" />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('capture.close')}
            onPress={onClose}
            style={styles.close}
            testID="passport-viewer-close"
          >
            <ClearIcon color={FG} />
          </Pressable>
        </View>
        <Image
          source={{ uri: `data:image/jpeg;base64,${base64}`, cache: 'reload' }}
          style={styles.image}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel={label}
          testID="passport-viewer-image"
        />
        <View style={styles.note}>
          <LockIcon color={MUTED} size={16} />
          <Text style={styles.footnote}>{t('viewer.secure')}</Text>
        </View>
      </SecureWindow>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SPACE },
  bar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  image: { flex: 1 },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 16,
  },
  footnote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: MUTED },
});
