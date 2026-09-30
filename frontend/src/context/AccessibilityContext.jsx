import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const AccessibilityContext = createContext(null);

const FONT_SIZES = ['Small', 'Medium', 'Large', 'Extra Large'];
const CONTRASTS = ['Normal', 'High'];
const BRIGHTNESS = ['Low', 'Normal', 'High'];

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

  const value = useMemo(() => ({
    fontSize, setFontSize: setFontSizeState, fontSizes: FONT_SIZES,
    contrast, setContrast: setContrastState, contrasts: CONTRASTS,
    brightness, setBrightness: setBrightnessState, brightnesses: BRIGHTNESS,
  }), [fontSize, contrast, brightness]);

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}

export function useAccessibility() {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error('useAccessibility must be used within AccessibilityProvider');
  return ctx;
}
