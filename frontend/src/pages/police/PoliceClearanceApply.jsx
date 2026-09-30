import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';

const PURPOSES = ['Employment', 'Travel or Visa', 'Education', 'Immigration', 'Other'];

export default function PoliceClearanceApply() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [preferredOfficeId, setPreferredOfficeId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!preferredOfficeId) { setError(t('offices.chooseBranchRequired')); return; }
    setBusy(true);
    try {
      await api.post('/police/clearance/apply', { serviceType: 'Police Clearance Certificate', purpose, preferredOfficeId });
      navigate('/police/clearance');
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('police.clearance.applyTitle')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('police.clearance.applyIntro')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <form onSubmit={onSubmit} className="card" noValidate>
        <FormField label={t('police.clearance.purpose')} htmlFor="purpose" required>
          <select id="purpose" className="form-input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => <option key={p} value={p}>{t(`police.clearance.purposeOption.${p}`)}</option>)}
          </select>
        </FormField>
        <DistrictOfficeSelect departmentKey="police" value={preferredOfficeId} onChange={setPreferredOfficeId} />
        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? t('common.loading') : t('police.clearance.submit')}</button>
      </form>
    </div>
  );
}
