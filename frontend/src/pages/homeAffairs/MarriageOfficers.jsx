import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import FormField from '../../components/ui/FormField';
import EmptyState from '../../components/ui/EmptyState';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';

const emptyForm = { fullName: '', officiantType: 'Religious', authorityOrDenomination: '', districtId: '', notes: '' };

/**
 * Registration of marriage officers — an internal registry Home Affairs officers maintain
 * directly (no citizen applicant, no entry in the generic applications index — see
 * backend/src/controllers/homeAffairsServices2.controller.js). Officer/admin only.
 */
export default function MarriageOfficers() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  function load() { api.get('/home-affairs/marriage-officers').then((d) => setRows(d.marriageOfficers)).catch(() => setRows([])); }
  useEffect(() => { if (isOfficer) load(); }, [isOfficer]);

  if (!isOfficer) {
    return <EmptyState icon="🔒" title={t('homeAffairs.marriageOfficersForm.officerOnly')} />;
  }

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setBusy(true);
    try {
      const result = await api.post('/home-affairs/marriage-officers', form);
      setSuccess(t('services.submittedWithReference', { reference: result.marriageOfficer.licence_number }));
      setForm(emptyForm);
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  async function setStatus(id, status) {
    setError(''); setSuccess(''); setBusy(true);
    try {
      await api.post(`/home-affairs/marriage-officers/${id}/status`, { status });
      setSuccess(t('services.actionRecorded'));
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.marriageOfficers')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('homeAffairs.marriageOfficersForm.intro')}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      <form onSubmit={onSubmit} className="card mb-8" noValidate>
        <FormField label={t('homeAffairs.marriageOfficersForm.field.fullName')} htmlFor="fullName" required>
          <input id="fullName" required className="form-input" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.marriageOfficersForm.field.officiantType')} htmlFor="officiantType" required>
          <select id="officiantType" required className="form-input" value={form.officiantType} onChange={(e) => update('officiantType', e.target.value)}>
            <option value="Religious">{t('homeAffairs.officiantType.religious')}</option>
            <option value="Civil">{t('homeAffairs.officiantType.civil')}</option>
            <option value="Traditional Chief">{t('homeAffairs.officiantType.chief')}</option>
          </select>
        </FormField>
        <FormField label={t('homeAffairs.marriageOfficersForm.field.authority')} htmlFor="authorityOrDenomination" help={t('common.optional')}>
          <input id="authorityOrDenomination" className="form-input" value={form.authorityOrDenomination} onChange={(e) => update('authorityOrDenomination', e.target.value)} />
        </FormField>
        <DistrictOfficeSelect departmentKey="home_affairs" value={form.districtId} onChange={(id) => update('districtId', id)} required={false} />
        <FormField label={t('homeAffairs.marriageOfficersForm.field.notes')} htmlFor="notes" help={t('common.optional')}>
          <textarea id="notes" rows={2} className="form-input" value={form.notes} onChange={(e) => update('notes', e.target.value)} />
        </FormField>
        <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('homeAffairs.marriageOfficersForm.register')}</button>
      </form>

      {!rows ? <Loading /> : (
        <DataTable
          rowKey="marriage_officer_registration_id"
          rows={rows}
          emptyTitle={t('common.noResults')}
          columns={[
            { key: 'licence', header: t('homeAffairs.marriageOfficersForm.licenceNumber'), render: (r) => <span className="font-mono text-xs">{r.licence_number}</span> },
            { key: 'name', header: t('homeAffairs.marriageOfficersForm.field.fullName') },
            { key: 'type', header: t('homeAffairs.marriageOfficersForm.field.officiantType'), render: (r) => r.officiant_type },
            { key: 'district', header: t('offices.district'), render: (r) => r.district_name || '—' },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions', header: t('common.actions'),
              render: (r) => (
                <div className="flex flex-wrap gap-2">
                  {r.status !== 'Registered' && (
                    <button type="button" disabled={busy} className="text-xs font-semibold text-gov-green underline" onClick={() => setStatus(r.marriage_officer_registration_id, 'Registered')}>{t('homeAffairs.marriageOfficersForm.reinstate')}</button>
                  )}
                  {r.status !== 'Suspended' && (
                    <button type="button" disabled={busy} className="text-xs font-semibold text-gov-amber underline" onClick={() => setStatus(r.marriage_officer_registration_id, 'Suspended')}>{t('homeAffairs.marriageOfficersForm.suspend')}</button>
                  )}
                  {r.status !== 'Revoked' && (
                    <button type="button" disabled={busy} className="text-xs font-semibold text-gov-red underline" onClick={() => setStatus(r.marriage_officer_registration_id, 'Revoked')}>{t('homeAffairs.marriageOfficersForm.revoke')}</button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
