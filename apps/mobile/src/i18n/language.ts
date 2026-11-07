import { I18nManager } from 'react-native';

export type AppLanguage = 'he' | 'en';

/**
 * Sprint 14 F-044 (AC-6): Hebrew exactly when the native layout is RTL, which
 * plugins/withLayoutDirection.js sets from the device language before React
 * starts. Reading the direction rather than the locale again means the text
 * and the layout can never disagree.
 */
export function appLanguage(isRTL: boolean = I18nManager.isRTL): AppLanguage {
  return isRTL ? 'he' : 'en';
}
