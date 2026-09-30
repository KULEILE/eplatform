import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';
import PhotoCapture from '../../components/PhotoCapture';
import { formatDateOnly } from '../../utils/format';

export default function NationalIdApply() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [photoReference, setPhotoReference] = useState(null);
  const [preferredOfficeId, setPreferredOfficeId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/citizen/profile').then(setProfile); }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!preferredOfficeId) { setError(t('offices.chooseBranchRequired')); return; }
    setBusy(true);
    try {
      const result = await api.post('/home-affairs/national-id/apply', { photoReference, preferredOfficeId });
      navigate(`/home-affairs/national-id/${result.nationalIdCardId}`);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return <Loading />;
  if (profile.provisional) {
    return <p className="mx-auto max-w-md rounded-md bg-amber-50 px-4 py-3 text-sm text-gov-amber">⚠ {t('auth.provisionalNotice')}</p>;
  }
  const c = profile.citizen;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.nationalIdForm.title')}</h1>
      <p className="mb-6 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {t('homeAffairs.nationalIdForm.eligibleNotice')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <div className="card">
        <p className="mb-4 text-sm text-slate-600">ℹ {t('homeAffairs.nationalIdForm.reuseNotice')}</p>
        <dl className="mb-4 grid grid-cols-1 gap-3 rounded-md bg-slate-50 p-4 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">Name</dt><dd className="font-medium">{c.first_name} {c.middle_name} {c.last_name}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('auth.dateOfBirth')}</dt><dd className="font-medium">{formatDateOnly(c.date_of_birth)}</dd></div>
          <div><dt className="text-xs text-slate-500">Sex</dt><dd className="font-medium">{c.sex}</dd></div>
          <div><dt className="text-xs text-slate-500">Place of birth</dt><dd className="font-medium">{c.place_of_birth}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-slate-500">{t('auth.permanentIdentityNumber')}</dt><dd className="font-mono font-medium">{c.permanent_identity_number}</dd></div>
        </dl>
        <p className="mb-4 text-xs text-slate-500">{t('homeAffairs.nationalIdForm.noNewNumberNotice')}</p>

        <form onSubmit={onSubmit}>
          <PhotoCapture
            value={photoReference}
            onChange={setPhotoReference}
            label={t('homeAffairs.nationalIdForm.photoCapture')}
            help={t('photoCapture.idHelp')}
          />
          <div className="mb-4 rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            {t('homeAffairs.nationalIdForm.biometricCapture')} — will be enrolled automatically during card production.
          </div>
          <DistrictOfficeSelect departmentKey="home_affairs" value={preferredOfficeId} onChange={setPreferredOfficeId} />
          <button type="submit" disabled={busy || !photoReference} className="btn-primary w-full">
            {busy ? t('common.loading') : t('homeAffairs.nationalIdForm.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
