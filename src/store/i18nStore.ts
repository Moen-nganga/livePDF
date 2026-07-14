import { create } from 'zustand';
import { translations, type Locale } from '../lib/i18n/translations';

// Same key AccountMenu.tsx has been writing to since the language picker
// was first built (before real translations existed) -- reusing it means
// whatever a user already picked keeps working instead of resetting.
const LANGUAGE_STORAGE_KEY = 'preferredLanguage';

function detectInitialLocale(): Locale {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored && stored in translations) return stored as Locale;
  return 'en';
}

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  // Looks up `key` in the current locale, falling back to English and
  // then to the raw key itself if a translation is missing -- this way a
  // string that hasn't been translated yet for a given language shows up
  // in English rather than a blank or a raw key like "landing.signIn".
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