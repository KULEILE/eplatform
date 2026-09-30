import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import FormField from '../components/ui/FormField';

export default function Login() {
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate(location.state?.from?.pathname || '/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || t('auth.loginError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="card">
        <h1 className="mb-6 text-xl font-bold text-slate-900">{t('auth.loginTitle')}</h1>
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        <form onSubmit={onSubmit} noValidate>
          <FormField label={t('auth.email')} htmlFor="email" required>
            <input id="email" type="email" required autoComplete="username" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label={t('auth.password')} htmlFor="password" required>
            <input id="password" type="password" required autoComplete="current-password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? t('common.loading') : t('auth.loginButton')}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-600">
          <Link to="/register" className="font-medium text-gov-navy hover:underline">{t('auth.dontHaveAccount')}</Link>
        </p>
      </div>
    </div>
  );
}
