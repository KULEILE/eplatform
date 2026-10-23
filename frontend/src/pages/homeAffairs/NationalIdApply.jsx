import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import PhotoCapture from '../../components/PhotoCapture';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';
import BackToDepartment from '../../components/BackToDepartment';
import Loading from '../../components/ui/Loading';

/**
 * First-time National ID application. Rewritten for the client's enhancement:
 *  - 16+, one-ID-for-life, and "already have a card in progress/collected" are now all server-
 *    side checks reported by GET /national-id/eligibility, loaded up front so the citizen sees
 *    why they can't apply (if they can't) before filling anything in, rather than after.
 *  - Hand biometrics are no longer self-captured on this form at all (see BiometricCapture.jsx,
 *    which this page used to use) — they are captured once, in person, by a police officer at a
 *    station the citizen chooses (see NationalIdBiometricCapture.jsx), and reused forever after.
 *    If the citizen already has both hands on file from any earlier service, this form skips the
 *    police-station step entirely and the card is approved immediately on submission.
 */
export default function NationalIdApply() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [eligibility, setEligibility] = useState(null);
  const [eligibilityError, setEligibilityError] = useState('');
  const [photoReference, setPhotoReference] = useState('');
  const [preferredOfficeId, setPreferredOfficeId] = useState('');
  const [biometricOfficeId, setBiometricOfficeId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get('/home-affairs/national-id/eligibility')
      .then(setEligibility)
      .catch((err) => setEligibilityError(err.message || t('common.somethingWentWrong')));
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!preferredOfficeId) { setError(t('offices.chooseBranchRequired')); return; }
    if (!eligibility.biometricsOnFile && !biometricOfficeId) { setError(t('homeAffairs.nationalIdForm.policeStationRequired')); return; }
    setBusy(true);
    try {
      const result = await api.post('/home-affairs/national-id/apply', {
        photoReference, preferredOfficeId, biometricOfficeId: eligibility.biometricsOnFile ? undefined : biometricOfficeId,
      });
      setResult(result);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  if (!eligibility && !eligibilityError) return <Loading />;

  return (
    <div>
      <BackToDepartment />
      <h1 className="mb-4 text-2xl font-bold text-slate-900">{t('homeAffairs.nationalIdForm.title')}</h1>

      {eligibilityError && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {eligibilityError}</p>}

      {result ? (
        <div className="card">
          <p className="mb-3 text-sm font-semibold text-gov-green">✓ {t('homeAffairs.nationalIdForm.submittedTitle')}</p>
          <p className="mb-4 text-sm text-slate-600">
            {result.status === 'Awaiting Biometric Capture' ? t('homeAffairs.nationalIdForm.submittedAwaitingBiometrics') : t('homeAffairs.nationalIdForm.submittedAutoApproved')}
          </p>
          <button type="button" className="btn-primary" onClick={() => navigate(`/home-affairs/national-id/${result.nationalIdCardId}`)}>{t('common.viewDetails')}</button>
        </div>
      ) : eligibility && !eligibility.meetsMinimumAge ? (
        <div className="card">
          <p className="text-sm text-gov-red">⚠ {t('homeAffairs.nationalIdForm.tooYoung', { minimumAge: eligibility.minimumAge, age: eligibility.age })}</p>
        </div>
      ) : eligibility && eligibility.hasInProgressApplication ? (
        <div className="card">
          <p className="text-sm text-gov-amber">⚠ {t('homeAffairs.nationalIdForm.alreadyInProgress')}</p>
        </div>
      ) : eligibility && eligibility.hasCollectedCard ? (
        <div className="card">
          <p className="mb-3 text-sm text-gov-amber">⚠ {t('homeAffairs.nationalIdForm.alreadyHaveCard')}</p>
          <button type="button" className="btn-primary" onClick={() => navigate('/home-affairs/national-id/renew-replace')}>{t('homeAffairs.nationalIdRenewReplace')}</button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card" noValidate>
          {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
          <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">ℹ {t('homeAffairs.nationalIdForm.eligibleNotice')}</p>
          <p className="mb-4 text-sm text-slate-600">{t('homeAffairs.nationalIdForm.reuseNotice')}</p>
          <p className="mb-4 text-xs text-slate-500">{t('homeAffairs.nationalIdForm.noNewNumberNotice')}</p>

          <PhotoCapture value={photoReference} onChange={setPhotoReference} label={t('homeAffairs.nationalIdForm.photoCapture')} faceCheck />

          <DistrictOfficeSelect departmentKey="home_affairs" value={preferredOfficeId} onChange={setPreferredOfficeId} />

          {eligibility.biometricsOnFile ? (
            <p className="mb-4 flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">
              ✓ {t('homeAffairs.nationalIdForm.biometricsOnFile')}
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm font-medium text-slate-700">{t('homeAffairs.nationalIdForm.biometricCapture')}</p>
              <p className="mb-3 text-xs text-slate-500">{t('homeAffairs.nationalIdForm.biometricCaptureHelp')}</p>
              <DistrictOfficeSelect departmentKey="police" value={biometricOfficeId} onChange={setBiometricOfficeId} />
            </>
          )}

          <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('homeAffairs.nationalIdForm.submit')}</button>
        </form>
      )}
    </div>
  );
}
