import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import PhotoCapture from '../../components/PhotoCapture';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';

const emptyForm = { applicationType: 'Renewal', replacementReason: '', replacementDetails: '', preferredOfficeId: '', photoReference: '' };

/**
 * National ID card renewal & replacement — reuses the existing national_id_cards table and its
 * full approval pipeline (NID_TRANSITIONS in homeAffairs.controller.js) unchanged; this page
 * only covers the "apply" step. Status after submission is tracked on the existing National ID
 * list/detail pages (NationalIdList.jsx / NationalIdDetail.jsx), which already show every card
 * a citizen holds — this new application just appears there with its application_type badge.
 */
export default function NationalIdRenewReplace() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api.post('/home-affairs/national-id/renew-replace', form);
      navigate('/home-affairs/national-id');
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.nationalIdRenewReplace')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('homeAffairs.nationalIdRenewReplaceForm.intro')}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <form onSubmit={onSubmit} className="card" noValidate>
        <FormField label={t('homeAffairs.nationalIdRenewReplaceForm.field.applicationType')} htmlFor="applicationType" required>
          <select id="applicationType" required className="form-input" value={form.applicationType} onChange={(e) => update('applicationType', e.target.value)}>
            <option value="Renewal">{t('homeAffairs.nationalIdRenewReplaceForm.renewal')}</option>
            <option value="Replacement">{t('homeAffairs.nationalIdRenewReplaceForm.replacement')}</option>
          </select>
        </FormField>

        {form.applicationType === 'Replacement' && (
          <>
            <FormField label={t('homeAffairs.nationalIdRenewReplaceForm.field.replacementReason')} htmlFor="replacementReason" required>
              <select id="replacementReason" required className="form-input" value={form.replacementReason} onChange={(e) => update('replacementReason', e.target.value)}>
                <option value="">—</option>
                <option value="Lost">{t('homeAffairs.replacementReason.lost')}</option>
                <option value="Stolen">{t('homeAffairs.replacementReason.stolen')}</option>
                <option value="Damaged">{t('homeAffairs.replacementReason.damaged')}</option>
                <option value="Expired">{t('homeAffairs.replacementReason.expired')}</option>
                <option value="Other">{t('homeAffairs.reissueReason.Other')}</option>
              </select>
            </FormField>
            <FormField label={t('homeAffairs.nationalIdRenewReplaceForm.field.replacementDetails')} htmlFor="replacementDetails" help={t('common.optional')}>
              <textarea id="replacementDetails" rows={3} className="form-input" value={form.replacementDetails} onChange={(e) => update('replacementDetails', e.target.value)} />
            </FormField>
          </>
        )}

        <PhotoCapture value={form.photoReference} onChange={(ref) => update('photoReference', ref)}
          label={t('homeAffairs.nationalIdRenewReplaceForm.field.photo')} help={t('homeAffairs.nationalIdRenewReplaceForm.field.photoHelp')} faceCheck />

        <DistrictOfficeSelect departmentKey="home_affairs" value={form.preferredOfficeId} onChange={(id) => update('preferredOfficeId', id)} />

        <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('common.submit')}</button>
      </form>
    </div>
  );
}
