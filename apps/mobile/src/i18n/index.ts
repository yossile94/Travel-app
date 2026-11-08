import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import he from './locales/he.json';
import { appLanguage } from './language';

export const resources = { he: { translation: he }, en: { translation: en } } as const;

// Hebrew on a Hebrew device, English on any other (sprint 14 F-044, AC-6).
export const defaultLanguage = appLanguage();

const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: defaultLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
