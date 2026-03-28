'use client';
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { type Locale, LOCALES, t as translate } from '@/lib/i18n';

const validCodes = new Set(LOCALES.map(l => l.code));
function isValidLocale(v: unknown): v is Locale {
  return typeof v === 'string' && validCodes.has(v as Locale);
}

type LocaleContextType = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  resetLocale: () => void;
  t: (key: string) => string;
};

const LocaleContext = createContext<LocaleContextType | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const saved = localStorage.getItem('uel-locale');
    if (isValidLocale(saved)) setLocaleState(saved);

    // Reage quando outro código (ex: AuthContext.detectRole) atualiza o localStorage
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'uel-locale' && isValidLocale(e.newValue)) {
        setLocaleState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);

    // Polling curto para capturar mudanças na mesma aba (StorageEvent só dispara entre abas)
    const interval = setInterval(() => {
      const current = localStorage.getItem('uel-locale');
      if (isValidLocale(current)) {
        setLocaleState(prev => prev !== current ? current : prev);
      }
    }, 500);

    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(interval);
    };
  }, []);

  const setLocale = useCallback((l: Locale) => {
    if (!isValidLocale(l)) return;
    setLocaleState(l);
    localStorage.setItem('uel-locale', l);
  }, []);

  const resetLocale = useCallback(() => {
    setLocaleState('en');
    localStorage.removeItem('uel-locale');
  }, []);

  const t = useCallback((key: string) => translate(key, locale), [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, resetLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale deve ser usado dentro de LocaleProvider');
  return ctx;
}
