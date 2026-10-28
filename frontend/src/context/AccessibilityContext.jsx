import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const AccessibilityContext = createContext(null);

const FONT_SIZES = ['Small', 'Medium', 'Large', 'Extra Large'];
const CONTRASTS = ['Normal', 'High'];
const BRIGHTNESS = ['Low', 'Normal', 'High'];
const THEMES = ['Light', 'Dark'];

// No stored choice yet — default to the device/browser's own light/dark preference rather than
// always forcing Light, so a citizen who already has their phone or OS set to dark mode gets a
// dark app on first visit instead of a surprise bright white screen.
function systemPrefersDark() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function readStored(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function AccessibilityProvider({ children }) {
  const [fontSize, setFontSizeState] = useState(() => readStored('gov_font_size', 'Medium', FONT_SIZES));
  const [contrast, setContrastState] = useState(() => readStored('gov_contrast', 'Normal', CONTRASTS));
  const [brightness, setBrightnessState] = useState(() => readStored('gov_brightness', 'Normal', BRIGHTNESS));
  const [theme, setThemeState] = useState(() => readStored('gov_theme', systemPrefersDark() ? 'Dark' : 'Light', THEMES));
  // Batch 39 — lifted out of Header.jsx's own local state so Footer.jsx's "Accessibility" link
  // can open the exact same panel instead of duplicating it. Header still owns the panel's
  // positioning logic (it measures its own button's position), this context only owns whether
  // it's open.
  const [a11yPanelOpen, setA11yPanelOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', fontSize);
    try { localStorage.setItem('gov_font_size', fontSize); } catch { /* ignore */ }
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.setAttribute('data-contrast', contrast);
    try { localStorage.setItem('gov_contrast', contrast); } catch { /* ignore */ }
  }, [contrast]);

  useEffect(() => {
    document.documentElement.setAttribute('data-brightness', brightness);
    try { localStorage.setItem('gov_brightness', brightness); } catch { /* ignore */ }
  }, [brightness]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('gov_theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const value = useMemo(() => ({
    fontSize, setFontSize: setFontSizeState, fontSizes: FONT_SIZES,
    contrast, setContrast: setContrastState, contrasts: CONTRASTS,
    brightness, setBrightness: setBrightnessState, brightnesses: BRIGHTNESS,
    theme, setTheme: setThemeState, themes: THEMES,
    a11yPanelOpen, setA11yPanelOpen,
  }), [fontSize, contrast, brightness, theme, a11yPanelOpen]);

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility() {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error('useAccessibility must be used within AccessibilityProvider');
  return ctx;
}
