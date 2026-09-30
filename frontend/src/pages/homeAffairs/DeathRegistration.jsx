import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import FormField from '../../components/ui/FormField';
import { formatDateOnly } from '../../utils/format';

const emptyForm = { permanentIdentityNumber: '', dateOfDeath: '', placeOfDeath: '' };

export default function DeathRegistration() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);
  return isOfficer ? <OfficerQueue t={t} /> : <CitizenReportForm t={t} />;
}

function CitizenReportForm({ t }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  function load() { api.get('/home-affairs/death-registration').then((d) => setRows(d.deathRegistrations)); }
  useEffect(() => { load(); }, []);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const result = await api.post('/home-affairs/death-registration', form);
      setSuccess(t('homeAffairs.deathForm.submitted', { name: result.deceasedName }));
      setForm(emptyForm);
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.deathRegistration')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('homeAffairs.deathForm.intro')}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      <form onSubmit={onSubmit} className="card mb-8" noValidate>
        <FormField label={t('homeAffairs.deathForm.deceasedPermanentId')} htmlFor="permanentIdentityNumber" required help={t('homeAffairs.deathForm.deceasedPermanentIdHelp')}>
          <input id="permanentIdentityNumber" required className="form-input" value={form.permanentIdentityNumber} onChange={(e) => update('permanentIdentityNumber', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.deathForm.dateOfDeath')} htmlFor="dateOfDeath" required>
          <input id="dateOfDeath" type="date" required className="form-input" value={form.dateOfDeath} onChange={(e) => update('dateOfDeath', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.deathForm.placeOfDeath')} htmlFor="placeOfDeath" help={t('common.optional')}>
          <input id="placeOfDeath" className="form-input" value={form.placeOfDeath} onChange={(e) => update('placeOfDeath', e.target.value)} />
        </FormField>
        <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('homeAffairs.deathForm.submit')}</button>
      </form>

      <h2 className="mb-3 text-lg font-semibold text-slate-900">{t('homeAffairs.deathForm.reportedByMe')}</h2>
      {!rows ? <Loading /> : (
        <DataTable
          rowKey="death_record_id"
          rows={rows}
          columns={[
            { key: 'registration_reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.registration_reference}</span> },
            { key: 'name', header: t('homeAffairs.deathForm.deceasedName'), render: (r) => `${r.first_name} ${r.last_name}` },
            { key: 'date_of_death', header: t('homeAffairs.deathForm.dateOfDeath'), render: (r) => formatDateOnly(r.date_of_death) },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      )}
    </div>
  );
}

function OfficerQueue({ t }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  function load() { api.get('/home-affairs/death-registration').then((d) => setRows(d.deathRegistrations)); }
  useEffect(() => { load(); }, []);

  async function approve(id) {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/home-affairs/death-registration/${id}/approve`, {});
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusyId(null);
    }
  }

  if (!rows) return <Loading />;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('homeAffairs.deathRegistration')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('homeAffairs.deathForm.officerIntro')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <DataTable
        rowKey="death_record_id"
        rows={rows}
        columns={[
          { key: 'registration_reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.registration_reference}</span> },
          { key: 'name', header: t('homeAffairs.deathForm.deceasedName'), render: (r) => `${r.first_name} ${r.last_name}` },
          { key: 'permanent_identity_number', header: t('auth.permanentIdentityNumber'), render: (r) => <span className="font-mono text-xs">{r.permanent_identity_number}</span> },
          { key: 'reporter', header: t('homeAffairs.deathForm.reportedBy'), render: (r) => `${r.reporter_first_name} ${r.reporter_last_name}` },
          { key: 'date_of_death', header: t('homeAffairs.deathForm.dateOfDeath'), render: (r) => formatDateOnly(r.date_of_death) },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          {
            key: 'actions', header: t('common.actions'),
            render: (r) => r.status === 'Submitted' ? (
              <button type="button" disabled={busyId === r.death_record_id} className="text-sm font-medium text-gov-navy hover:underline" onClick={() => approve(r.death_record_id)}>{t('common.approve')}</button>
            ) : <span className="text-sm text-slate-400">—</span>,
          },
        ]}
      />
    </div>
  );
}
