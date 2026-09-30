import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, setToken, getStoredToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  const loadMe = useCallback(async () => {
    if (!getStoredToken()) { setUser(null); setInitializing(false); return; }
    try {
      const { user: u } = await api.get('/auth/me');
      setUser(u);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setInitializing(false);
    }
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const login = useCallback(async (email, password) => {
    const { token, user: u } = await api.post('/auth/login', { email, password });
    setToken(token);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (payload) => {
    const { token, user: u } = await api.post('/auth/register', payload);
    setToken(token);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, initializing, login, register, logout, refresh: loadMe }), [user, initializing, login, register, logout, loadMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
