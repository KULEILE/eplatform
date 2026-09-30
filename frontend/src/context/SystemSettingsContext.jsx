import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '../api/client';

const SystemSettingsContext = createContext(null);

export function SystemSettingsProvider({ children }) {
  const [settings, setSettings] = useState({ system_name: 'Integrated Government Services', government_logo_reference: null });
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { settings: s } = await api.get('/public/settings');
      setSettings(s);
    } catch {
      // fall back silently to defaults — branding must never block the app from loading
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const logoUrl = settings.government_logo_reference ? `/uploads/${settings.government_logo_reference}` : null;

  const value = useMemo(() => ({ settings, loaded, refresh, logoUrl }), [settings, loaded, refresh, logoUrl]);

  return <SystemSettingsContext.Provider value={value}>{children}</SystemSettingsContext.Provider>;
}

export function useSystemSettings() {
  const ctx = useContext(SystemSettingsContext);
  if (!ctx) throw new Error('useSystemSettings must be used within SystemSettingsProvider');
  return ctx;
}
