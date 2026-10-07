import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { englishCatalog } from './locale-catalog.js';

export type Language = 'en' | 'zh';
export const LANGUAGE_KEY = 'arc-ui-language';
export function initialLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}
const phrases = Object.entries(englishCatalog).sort((a, b) => b[0].length - a[0].length);
export function translateText<T>(value: T, language: Language): T {
  if (language === 'zh' || typeof value !== 'string') return value;
  const normalized = value.replace(/\s+/g, ' ').trim();
  const exact = englishCatalog[normalized];
  if (exact) return (value.match(/^\s*/)?.[0] + exact + value.match(/\s*$/)?.[0]) as T;
  let text: string = value;
  for (const [zh, en] of phrases) if (text.includes(zh)) text = text.split(zh).join(en);
  return text as T;
}
const LanguageContext = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
}>({
  language: 'en' as Language,
  setLanguage: () => undefined,
});
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.title = language === 'en' ? 'Arc USDC Settlement Verifier' : 'Arc USDC 结算核验器';
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // A blocked storage preference must not prevent using the verifier.
    }
  }, [language]);
  return <LanguageContext value={{ language, setLanguage }}>{children}</LanguageContext>;
}
export function useLanguage() {
  const context = useContext(LanguageContext);
  return {
    ...context,
    locale: context.language === 'en' ? 'en-SG' : 'zh-CN',
    t: (zh: string, en: string) => (context.language === 'zh' ? zh : en),
    localize: <T,>(value: T): T => translateText(value, context.language),
    date: (value: string) =>
      new Intl.DateTimeFormat(context.language === 'en' ? 'en-SG' : 'zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: 'UTC',
      }).format(new Date(value)) + ' UTC',
  };
}
export function LanguageSwitch() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <nav className="language-switch" aria-label={t('界面语言', 'Interface language')}>
      <button lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>
        English
      </button>
      <button lang="zh-CN" aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>
        中文
      </button>
    </nav>
  );
}
