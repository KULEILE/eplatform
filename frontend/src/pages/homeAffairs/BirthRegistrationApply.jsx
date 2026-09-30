import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';

export default function BirthRegistrationApply() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    childFirstName: '', childMiddleName: '', childLastName: '', dateOfBirth: '', placeOfBirth: '', sex: 'Male',
    // The official Lesotho birth certificate records the parents and the informant who reported
    // the birth — collected here so the certificate can be issued in that format.
    fatherName: '', fatherNationality: 'Mosotho',
    motherName: '', motherMaidenSurname: '', motherNationality: 'Mosotho', motherResidence: '',
    informantName: '', informantCapacity: '', informantResidence: '',
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
      const result = await api.post('/home-affairs/birth-registration', { ...form, preferredOfficeId });
      navigate(`/home-affairs/birth-registration/${result.birthRecordId}`);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('homeAffairs.birthRegistrationForm.title')}</h1>
      <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">ℹ {t('homeAffairs.birthRegistrationForm.parentInfoReused')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <form onSubmit={onSubmit} className="card" noValidate>
        <FormField label={t('homeAffairs.birthRegistrationForm.childFirstName')} htmlFor="cfn" required>
          <input id="cfn" required className="form-input" value={form.childFirstName} onChange={(e) => update('childFirstName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.childMiddleName')} htmlFor="cmn">
          <input id="cmn" className="form-input" value={form.childMiddleName} onChange={(e) => update('childMiddleName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.childLastName')} htmlFor="cln" required>
          <input id="cln" required className="form-input" value={form.childLastName} onChange={(e) => update('childLastName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.dateOfBirth')} htmlFor="dob" required>
          <input id="dob" type="date" required className="form-input" value={form.dateOfBirth} onChange={(e) => update('dateOfBirth', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.placeOfBirth')} htmlFor="pob" required>
          <input id="pob" required className="form-input" value={form.placeOfBirth} onChange={(e) => update('placeOfBirth', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.sex')} htmlFor="sex" required>
          <select id="sex" className="form-input" value={form.sex} onChange={(e) => update('sex', e.target.value)}>
            <option>Male</option><option>Female</option><option>Other</option><option>Unspecified</option>
          </select>
        </FormField>
        <p className="form-label mb-2 mt-6 border-t border-slate-100 pt-4 !text-sm font-semibold uppercase tracking-wide text-slate-500">{t('homeAffairs.birthRegistrationForm.fatherDetails')}</p>
        <FormField label={t('homeAffairs.birthRegistrationForm.fatherName')} htmlFor="fatherName">
          <input id="fatherName" className="form-input" value={form.fatherName} onChange={(e) => update('fatherName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.fatherNationality')} htmlFor="fatherNationality">
          <input id="fatherNationality" className="form-input" value={form.fatherNationality} onChange={(e) => update('fatherNationality', e.target.value)} />
        </FormField>

        <p className="form-label mb-2 mt-6 border-t border-slate-100 pt-4 !text-sm font-semibold uppercase tracking-wide text-slate-500">{t('homeAffairs.birthRegistrationForm.motherDetails')}</p>
        <FormField label={t('homeAffairs.birthRegistrationForm.motherName')} htmlFor="motherName">
          <input id="motherName" className="form-input" value={form.motherName} onChange={(e) => update('motherName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.motherMaidenSurname')} htmlFor="motherMaidenSurname">
          <input id="motherMaidenSurname" className="form-input" value={form.motherMaidenSurname} onChange={(e) => update('motherMaidenSurname', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.motherNationality')} htmlFor="motherNationality">
          <input id="motherNationality" className="form-input" value={form.motherNationality} onChange={(e) => update('motherNationality', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.motherResidence')} htmlFor="motherResidence">
          <input id="motherResidence" className="form-input" value={form.motherResidence} onChange={(e) => update('motherResidence', e.target.value)} />
        </FormField>

        <p className="form-label mb-2 mt-6 border-t border-slate-100 pt-4 !text-sm font-semibold uppercase tracking-wide text-slate-500">{t('homeAffairs.birthRegistrationForm.informantDetails')}</p>
        <p className="mb-3 text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.informantHelp')}</p>
        <FormField label={t('homeAffairs.birthRegistrationForm.informantName')} htmlFor="informantName">
          <input id="informantName" className="form-input" value={form.informantName} onChange={(e) => update('informantName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.informantCapacity')} htmlFor="informantCapacity" help={t('homeAffairs.birthRegistrationForm.informantCapacityHelp')}>
          <input id="informantCapacity" className="form-input" value={form.informantCapacity} onChange={(e) => update('informantCapacity', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.informantResidence')} htmlFor="informantResidence">
          <input id="informantResidence" className="form-input" value={form.informantResidence} onChange={(e) => update('informantResidence', e.target.value)} />
        </FormField>

        <FormField label={t('homeAffairs.birthRegistrationForm.uploadDocuments')} htmlFor="docs" help="You can upload supporting documents after submitting, from the application's detail page.">
          <input id="docs" type="file" disabled className="text-sm text-slate-400" />
        </FormField>
        <DistrictOfficeSelect departmentKey="home_affairs" value={preferredOfficeId} onChange={setPreferredOfficeId} />
        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? t('common.loading') : t('homeAffairs.birthRegistrationForm.submit')}</button>
      </form>
    </div>
  );
}
