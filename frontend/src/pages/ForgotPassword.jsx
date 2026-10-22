import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import FormField from '../components/ui/FormField';

// Must match backend/src/utils/securityQuestions.js exactly — see that file's comment.
const SECURITY_QUESTION_LABELS = {
  mothersMaidenName: 'auth.securityQuestions.mothersMaidenName',
  firstSchool: 'auth.securityQuestions.firstSchool',
  childhoodNickname: 'auth.securityQuestions.childhoodNickname',
  firstPetName: 'auth.securityQuestions.firstPetName',
  birthVillage: 'auth.securityQuestions.birthVillage',
  favoriteTeacher: 'auth.securityQuestions.favoriteTeacher',
};

/**
 * No email or phone is required to log in, so there is nowhere to "send a reset link" to.
 * Recovery instead walks through the two security questions the citizen set at registration:
 *   1) enter username -> server returns WHICH two questions this account chose (not the answers)
 *   2) answer both -> server checks them and, if correct, returns a short-lived reset token
 *   3) set a new password using that token
 */
export default function ForgotPassword() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [step, setStep] = useState('username'); // username -> answers -> newPassword -> done
  const [username, setUsername] = useState('');
  const [questionKeys, setQuestionKeys] = useState([]);
  const [answer1, setAnswer1] = useState('');
  const [answer2, setAnswer2] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmitUsername(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { questionKeys: keys } = await api.post('/auth/forgot-password/start', { username });
      setQuestionKeys(keys);
      setStep('answers');
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitAnswers(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { resetToken: token } = await api.post('/auth/forgot-password/verify', {
        username,
        answers: [
          { questionKey: questionKeys[0], answer: answer1 },
          { questionKey: questionKeys[1], answer: answer2 },
        ],
      });
      setResetToken(token);
      setStep('newPassword');
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitNewPassword(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmNewPassword) { setError(t('auth.passwordsDoNotMatch')); return; }
    if (newPassword.length < 8) { setError(t('auth.passwordTooShort')); return; }
    setBusy(true);
    try {
      await api.post('/auth/forgot-password/reset', { resetToken, newPassword });
      setStep('done');
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="card">
        <h1 className="mb-6 text-xl font-bold text-slate-900">{t('auth.forgotPasswordTitle')}</h1>
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

        {step === 'username' && (
          <form onSubmit={onSubmitUsername} noValidate>
            <p className="mb-4 text-sm text-slate-600">{t('auth.forgotPasswordUsernameIntro')}</p>
            <FormField label={t('auth.username')} htmlFor="fp-username" required>
              <input id="fp-username" required autoComplete="username" autoCapitalize="none" className="form-input" value={username} onChange={(e) => setUsername(e.target.value)} />
            </FormField>
            <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? t('common.loading') : t('common.next')}</button>
          </form>
        )}

        {step === 'answers' && (
          <form onSubmit={onSubmitAnswers} noValidate>
            <p className="mb-4 text-sm text-slate-600">{t('auth.forgotPasswordAnswersIntro')}</p>
            <FormField label={t(SECURITY_QUESTION_LABELS[questionKeys[0]])} htmlFor="fp-answer1" required>
              <input id="fp-answer1" required className="form-input" value={answer1} onChange={(e) => setAnswer1(e.target.value)} />
            </FormField>
            <FormField label={t(SECURITY_QUESTION_LABELS[questionKeys[1]])} htmlFor="fp-answer2" required>
              <input id="fp-answer2" required className="form-input" value={answer2} onChange={(e) => setAnswer2(e.target.value)} />
            </FormField>
            <div className="flex gap-3">
              <button type="button" className="btn-secondary" onClick={() => setStep('username')}>{t('common.back')}</button>
              <button type="submit" disabled={busy} className="btn-primary flex-1">{busy ? t('common.loading') : t('common.next')}</button>
            </div>
          </form>
        )}

        {step === 'newPassword' && (
          <form onSubmit={onSubmitNewPassword} noValidate>
            <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {t('auth.forgotPasswordAnswersCorrect')}</p>
            <FormField label={t('auth.newPassword')} htmlFor="fp-new-password" required help={t('auth.passwordRequirement')}>
              <input id="fp-new-password" type="password" required minLength={8} autoComplete="new-password" className="form-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </FormField>
            <FormField label={t('auth.confirmNewPassword')} htmlFor="fp-confirm-password" required>
              <input id="fp-confirm-password" type="password" required autoComplete="new-password" className="form-input" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} />
            </FormField>
            <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? t('common.loading') : t('auth.forgotPasswordResetButton')}</button>
          </form>
        )}

        {step === 'done' && (
          <div>
            <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {t('auth.forgotPasswordDone')}</p>
            <button type="button" className="btn-primary w-full" onClick={() => navigate('/login', { replace: true })}>{t('auth.loginButton')}</button>
          </div>
        )}

        {step !== 'done' && (
          <p className="mt-4 text-center text-sm text-slate-600">
            <Link to="/login" className="font-medium text-gov-navy hover:underline">{t('common.back')}</Link>
          </p>
        )}
      </div>
    </div>
  );
}
