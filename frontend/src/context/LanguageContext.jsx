import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import en from '../locales/en.json';
import st from '../locales/st.json';

const DICTIONARIES = { en, st };
const LanguageContext = createContext(null);

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : `{{${key}}}`));
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    try { return localStorage.getItem('gov_language') || 'en'; } catch { return 'en'; }
  });

  const setLanguage = useCallback((lang) => {
    setLanguageState(lang);
    try { localStorage.setItem('gov_language', lang); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key, vars) => {
    const dict = DICTIONARIES[language] || DICTIONARIES.en;
    const value = getByPath(dict, key) ?? getByPath(DICTIONARIES.en, key) ?? key;
    return typeof value === 'string' ? interpolate(value, vars) : value;
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
