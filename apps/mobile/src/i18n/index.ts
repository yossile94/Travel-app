import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import he from './locales/he.json';

export const resources = { he: { translation: he }, en: { translation: en } } as const;

// Hebrew is the product's primary language and the layout is forced RTL
// (expo-localization `forcesRTL`). Choosing English in settings comes later.
export const defaultLanguage = 'he';

const i18n = createInstance();

void i18n.use(initReactI18next).init({
  resources,
  lng: defaultLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
