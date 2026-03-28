'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { type Locale, t as translate } from '@/lib/i18n';

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
    const saved = localStorage.getItem('uel-locale') as Locale;
    if (saved) setLocaleState(saved);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('uel-locale', l);
  };

  const resetLocale = () => {
    setLocaleState('en');
    localStorage.removeItem('uel-locale');
  };

  const t = (key: string) => translate(key, locale);

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
