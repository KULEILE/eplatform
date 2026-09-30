import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';

export default function DivorceRegistrationApply() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    spouseName: '', spousePermanentIdentityNumber: '', marriageReference: '',
    courtName: '', courtOrderReference: '', divorceOrderDate: '',
  });
  const [preferredOfficeId, setPreferredOfficeId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!preferredOfficeId) { setError(t('offices.chooseBranchRequired')); return; }
    setBusy(true);
    try {
      const result = await api.post('/home-affairs/divorce-registration', { ...form, preferredOfficeId });
      navigate(`/home-affairs/divorce-registration/${result.divorceRecordId}`);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.divorceForm.title')}</h1>
      <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">ℹ {t('homeAffairs.divorceForm.courtNotice')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <form onSubmit={onSubmit} className="card" noValidate>
        <FormField label={t('homeAffairs.divorceForm.spouseName')} htmlFor="spouseName" required>
          <input id="spouseName" required className="form-input" value={form.spouseName} onChange={(e) => update('spouseName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.divorceForm.spousePermanentId')} htmlFor="spousePermanentIdentityNumber" help={t('common.optional')}>
          <input id="spousePermanentIdentityNumber" className="form-input" value={form.spousePermanentIdentityNumber} onChange={(e) => update('spousePermanentIdentityNumber', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.divorceForm.marriageReference')} htmlFor="marriageReference" help={t('homeAffairs.divorceForm.marriageReferenceHelp')}>
          <input id="marriageReference" className="form-input" value={form.marriageReference} onChange={(e) => update('marriageReference', e.target.value)} />
        </FormField>

        <p className="form-label mb-2 mt-6 border-t border-slate-100 pt-4 !text-sm font-semibold uppercase tracking-wide text-slate-500">{t('homeAffairs.divorceForm.courtDetails')}</p>
        <FormField label={t('homeAffairs.divorceForm.courtName')} htmlFor="courtName" required>
          <input id="courtName" required className="form-input" value={form.courtName} onChange={(e) => update('courtName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.divorceForm.courtOrderReference')} htmlFor="courtOrderReference" required>
          <input id="courtOrderReference" required className="form-input" value={form.courtOrderReference} onChange={(e) => update('courtOrderReference', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.divorceForm.divorceOrderDate')} htmlFor="divorceOrderDate" required>
          <input id="divorceOrderDate" type="date" required className="form-input" value={form.divorceOrderDate} onChange={(e) => update('divorceOrderDate', e.target.value)} />
        </FormField>

        <DistrictOfficeSelect departmentKey="home_affairs" value={preferredOfficeId} onChange={setPreferredOfficeId} />
        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? t('common.loading') : t('homeAffairs.divorceForm.submit')}</button>
      </form>
    </div>
  );
}
