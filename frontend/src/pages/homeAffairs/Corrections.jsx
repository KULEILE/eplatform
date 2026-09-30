import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';

const FIELDS = ['first_name', 'middle_name', 'last_name', 'place_of_birth', 'sex'];

export default function Corrections() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ fieldName: 'first_name', currentValue: '', requestedValue: '', reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() { api.get('/home-affairs/correction').then((d) => setRows(d.corrections)); }
  useEffect(() => { load(); }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/home-affairs/correction', form);
      setForm({ fieldName: 'first_name', currentValue: '', requestedValue: '', reason: '' });
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function decide(id, approve) {
    await api.post(`/home-affairs/correction/${id}/decide`, { approve });
    load();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('homeAffairs.correction')}</h1>

      {!isOfficer && (
        <form onSubmit={onSubmit} className="card mb-8" noValidate>
          <h2 className="mb-4 font-semibold text-slate-800">{t('homeAffairs.correctionForm.title')}</h2>
          {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
          <FormField label={t('homeAffairs.correctionForm.field')} htmlFor="field" required>
            <select id="field" className="form-input" value={form.fieldName} onChange={(e) => setForm((f) => ({ ...f, fieldName: e.target.value }))}>
              {FIELDS.map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
            </select>
          </FormField>
          <FormField label={t('homeAffairs.correctionForm.currentValue')} htmlFor="current">
            <input id="current" className="form-input" value={form.currentValue} onChange={(e) => setForm((f) => ({ ...f, currentValue: e.target.value }))} />
          </FormField>
          <FormField label={t('homeAffairs.correctionForm.requestedValue')} htmlFor="requested" required>
            <input id="requested" required className="form-input" value={form.requestedValue} onChange={(e) => setForm((f) => ({ ...f, requestedValue: e.target.value }))} />
          </FormField>
          <FormField label={t('homeAffairs.correctionForm.reason')} htmlFor="reason" required>
            <textarea id="reason" required rows={3} className="form-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </FormField>
          <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('homeAffairs.correctionForm.submit')}</button>
        </form>
      )}

      {rows && (
        <DataTable
          rowKey="correction_id"
          rows={rows}
          columns={[
            ...(isOfficer ? [{ key: 'name', header: 'Citizen', render: (r) => `${r.first_name} ${r.last_name}` }] : []),
            { key: 'field_name', header: 'Field', render: (r) => r.field_name.replace(/_/g, ' ') },
            { key: 'requested_value', header: t('homeAffairs.correctionForm.requestedValue') },
            { key: 'reason', header: t('common.reason') },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            ...(isOfficer ? [{
              key: 'actions', header: t('common.actions'),
              render: (r) => r.status === 'Submitted' || r.status === 'Under Review' ? (
                <div className="flex gap-2">
                  <button type="button" className="text-sm font-medium text-gov-green hover:underline" onClick={() => decide(r.correction_id, true)}>{t('common.approve')}</button>
                  <button type="button" className="text-sm font-medium text-gov-red hover:underline" onClick={() => decide(r.correction_id, false)}>{t('common.reject')}</button>
                </div>
              ) : null,
            }] : []),
          ]}
        />
      )}
    </div>
  );
}
