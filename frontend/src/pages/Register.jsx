import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import FormField from '../components/ui/FormField';

export default function Register() {
  const { register } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [step, setStep] = useState('choice'); // choice -> verify -> accountForm  |  choice -> accountForm (provisional)
  const [mode, setMode] = useState(null); // 'existing' | 'provisional'
  const [permanentIdentityNumber, setPin] = useState('');
  const [dateOfBirth, setDob] = useState('');
  const [verifiedCitizen, setVerifiedCitizen] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState('');

  async function onVerify(e) {
    e.preventDefault();
    setVerifyError('');
    setBusy(true);
    try {
      const { citizen } = await api.post('/identity/verify', { permanentIdentityNumber, dateOfBirth });
      setVerifiedCitizen(citizen);
      setStep('accountForm');
    } catch (err) {
      setVerifyError(err.message || t('auth.identityNotFound'));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateAccount(e) {
    e.preventDefault();
    setFormError('');
    if (password !== confirmPassword) { setFormError("Passwords don't match."); return; }
    setBusy(true);
    try {
      await register({
        mode,
        email,
        phone,
        password,
        ...(mode === 'existing' ? { permanentIdentityNumber, dateOfBirth } : {}),
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setFormError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="card">
        <h1 className="mb-6 text-xl font-bold text-slate-900">{t('auth.createAccountTitle')}</h1>

        {step === 'choice' && (
          <div>
            <p className="form-label">{t('auth.chooseIdentityOption')}</p>
            <div className="mt-3 flex flex-col gap-3">
              <button type="button" className="btn-primary" onClick={() => { setMode('existing'); setStep('verify'); }}>
                {t('auth.haveIdentityNumber')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setMode('provisional'); setStep('accountForm'); }}>
                {t('auth.needToRegister')}
              </button>
            </div>
          </div>
        )}

        {step === 'verify' && (
          <form onSubmit={onVerify} noValidate>
            {verifyError && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {verifyError}</p>}
            <FormField label={t('auth.permanentIdentityNumber')} htmlFor="pin" required>
              <input id="pin" required className="form-input" value={permanentIdentityNumber} onChange={(e) => setPin(e.target.value)} />
            </FormField>
            <FormField label={t('auth.dateOfBirth')} htmlFor="dob" required>
              <input id="dob" type="date" required className="form-input" value={dateOfBirth} onChange={(e) => setDob(e.target.value)} />
            </FormField>
            <div className="flex gap-3">
              <button type="button" className="btn-secondary" onClick={() => setStep('choice')}>{t('common.back')}</button>
              <button type="submit" disabled={busy} className="btn-primary flex-1">{busy ? t('common.loading') : t('auth.verifyIdentityButton')}</button>
            </div>
          </form>
        )}

        {step === 'accountForm' && (
          <form onSubmit={onCreateAccount} noValidate>
            {mode === 'existing' && verifiedCitizen && (
              <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">
                ✓ {t('auth.identityVerified')}: {verifiedCitizen.firstName} {verifiedCitizen.lastName}
              </p>
            )}
            {mode === 'provisional' && (
              <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">⚠ {t('auth.provisionalNotice')}</p>
            )}
            {formError && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {formError}</p>}
            <FormField label={t('auth.email')} htmlFor="email" required>
              <input id="email" type="email" required autoComplete="username" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label={t('auth.phone')} htmlFor="phone">
              <input id="phone" className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
            <FormField label={t('auth.password')} htmlFor="password" required help={t('auth.passwordRequirement')}>
              <input id="password" type="password" required minLength={8} autoComplete="new-password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} />
            </FormField>
            <FormField label={t('auth.confirmPassword')} htmlFor="confirmPassword" required>
              <input id="confirmPassword" type="password" required autoComplete="new-password" className="form-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </FormField>
            <div className="flex gap-3">
              <button type="button" className="btn-secondary" onClick={() => setStep(mode === 'existing' ? 'verify' : 'choice')}>{t('common.back')}</button>
              <button type="submit" disabled={busy} className="btn-primary flex-1">{busy ? t('common.loading') : t('auth.createAccountButton')}</button>
            </div>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-slate-600">
          <Link to="/login" className="font-medium text-gov-navy hover:underline">{t('auth.alreadyHaveAccount')}</Link>
        </p>
      </div>
    </div>
  );
}
