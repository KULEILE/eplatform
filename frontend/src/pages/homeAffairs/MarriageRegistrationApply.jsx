import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';

export default function MarriageRegistrationApply() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    spouse2Name: '', spouse2DateOfBirth: '', spouse2Nationality: 'Mosotho', spouse2PermanentIdentityNumber: '',
    marriageType: 'Civil', marriageDate: '', placeOfMarriage: '', witness1Name: '', witness2Name: '', officiantName: '',
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
      const result = await api.post('/home-affairs/marriage-registration', { ...form, preferredOfficeId });
      navigate(`/home-affairs/marriage-registration/${result.marriageRecordId}`);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.marriageForm.title')}</h1>
      <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">ℹ {t('homeAffairs.marriageForm.filerInfoReused')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <form onSubmit={onSubmit} className="card" noValidate>
        <FormField label={t('homeAffairs.marriageForm.marriageType')} htmlFor="marriageType" required>
          <select id="marriageType" className="form-input" value={form.marriageType} onChange={(e) => update('marriageType', e.target.value)}>
            <option value="Civil">{t('homeAffairs.marriageForm.civil')}</option>
            <option value="Customary">{t('homeAffairs.marriageForm.customary')}</option>
          </select>
        </FormField>
        <FormField label={t('homeAffairs.marriageForm.marriageDate')} htmlFor="marriageDate" required>
          <input id="marriageDate" type="date" required className="form-input" value={form.marriageDate} onChange={(e) => update('marriageDate', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.marriageForm.placeOfMarriage')} htmlFor="placeOfMarriage" required>
          <input id="placeOfMarriage" required className="form-input" value={form.placeOfMarriage} onChange={(e) => update('placeOfMarriage', e.target.value)} />
        </FormField>

        <p className="form-label mb-2 mt-6 border-t border-slate-100 pt-4 !text-sm font-semibold uppercase tracking-wide text-slate-500">{t('homeAffairs.marriageForm.spouseDetails')}</p>
        <FormField label={t('homeAffairs.marriageForm.spouseName')} htmlFor="spouse2Name" required>
          <input id="spouse2Name" required className="form-input" value={form.spouse2Name} onChange={(e) => update('spouse2Name', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.marriageForm.spouseDateOfBirth')} htmlFor="spouse2DateOfBirth" help={t('common.optional')}>
          <input id="spouse2DateOfBirth" type="date" className="form-input" value={form.spouse2DateOfBirth} onChange={(e) => update('spouse2DateOfBirth', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.marriageForm.spouseNationality')} htmlFor="spouse2Nationality">
          <input id="spouse2Nationality" className="form-input" value={form.spouse2Nationality} onChange={(e) => update('spouse2Nationality', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.marriageForm.spousePermanentId')} htmlFor="spouse2PermanentIdentityNumber" help={t('homeAffairs.marriageForm.spousePermanentIdHelp')}>
          <input id="spouse2PermanentIdentityNumber" className="form-input" value={form.spouse2PermanentIdentityNumber} onChange={(e) => update('spouse2PermanentIdentityNumber', e.target.value)} />
        </FormField>

        <p className="form-label mb-2 mt-6 border-t border-slate-100 pt-4 !text-sm font-semibold uppercase tracking-wide text-slate-500">{t('homeAffairs.marriageForm.witnessDetails')}</p>
        <FormField label={t('homeAffairs.marriageForm.witness1Name')} htmlFor="witness1Name" required>
          <input id="witness1Name" required className="form-input" value={form.witness1Name} onChange={(e) => update('witness1Name', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.marriageForm.witness2Name')} htmlFor="witness2Name" required>
          <input id="witness2Name" required className="form-input" value={form.witness2Name} onChange={(e) => update('witness2Name', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.marriageForm.officiantName')} htmlFor="officiantName" help={t('common.optional')}>
          <input id="officiantName" className="form-input" value={form.officiantName} onChange={(e) => update('officiantName', e.target.value)} />
        </FormField>

        <DistrictOfficeSelect departmentKey="home_affairs" value={preferredOfficeId} onChange={setPreferredOfficeId} />
        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? t('common.loading') : t('homeAffairs.marriageForm.submit')}</button>
      </form>
    </div>
  );
}
