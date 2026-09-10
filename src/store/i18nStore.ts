import { create } from 'zustand';
import { translations, type Locale } from '../lib/i18n/translations';

const LANGUAGE_STORAGE_KEY = 'preferredLanguage';

function detectInitialLocale(): Locale {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && stored in translations) return stored as Locale;
  return 'en';
}

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export const useI18nStore = create<I18nState>((set, get) => ({
  locale: detectInitialLocale(),

  setLocale: (locale) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
    set({ locale });
  },

  t: (key, vars) => {
    const { locale } = get();
    let str = translations[locale]?.[key] ?? translations.en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.split(`{${k}}`).join(String(v));
      }
    }
    return str;
  },
}));