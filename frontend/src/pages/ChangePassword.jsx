import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import FormField from '../components/ui/FormField';

export default function ChangePassword() {
  const { user, refresh, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError(t('auth.passwordTooShort')); return; }
    if (newPassword !== confirmPassword) { setError(t('auth.passwordsDoNotMatch')); return; }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      await refresh();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-6">
      <div className="card">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gov-navy text-white"><KeyIcon className="h-5 w-5" strokeWidth={1.75} /></span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">{t('auth.changePasswordTitle')}</h1>
            <p className="text-sm text-slate-500">{t('auth.changePasswordSubtitle')}</p>
          </div>
        </div>

        {user?.mustChangePassword && (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">⚠ {t('auth.mustChangePasswordNotice')}</p>
        )}
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

        <form onSubmit={onSubmit} noValidate>
          <FormField label={t('auth.currentPassword')} htmlFor="currentPassword" required>
            <input id="currentPassword" type="password" required autoComplete="current-password" className="form-input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </FormField>
          <FormField label={t('auth.newPassword')} htmlFor="newPassword" required help={t('auth.passwordRequirementsHelp')}>
            <input id="newPassword" type="password" required autoComplete="new-password" minLength={8} className="form-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </FormField>
          <FormField label={t('auth.confirmNewPassword')} htmlFor="confirmPassword" required>
            <input id="confirmPassword" type="password" required autoComplete="new-password" className="form-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </FormField>
          <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? t('common.loading') : t('auth.changePasswordSubmit')}</button>
        </form>

        {user?.mustChangePassword && (
          <button
            type="button"
            onClick={async () => { await logout(); navigate('/login'); }}
            className="mt-4 w-full text-center text-sm text-slate-500 hover:underline"
          >
            {t('nav.logout')}
          </button>
        )}
      </div>
    </div>
  );
}
