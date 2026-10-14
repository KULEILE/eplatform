import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import FormField from './ui/FormField';
import DataTable from './ui/DataTable';
import StatusBadge from './ui/StatusBadge';

/**
 * Generic error-correction UI (FR12): a citizen flags a wrong field in a department's own
 * verified record, and that department's officer reviews and decides it. Backed by the shared
 * /api/corrections endpoints (corrections.controller.js) — the `corrections` table (migration
 * 020) was designed to be generic across departments from the start, this is what makes the
 * frontend generic too, instead of Home Affairs having its own one-off page and every other
 * department needing to build its own from scratch (Finance needed the same mechanism for
 * "I was wrongly declared a government employee" — see finance.controller.js).
 *
 * props:
 *   departmentKey — must match a key corrections.controller.js's CORRECTABLE_FIELDS allows.
 *   officerRoleKey — e.g. 'home_affairs_officer', 'finance_officer'.
 *   fields: [{ name, label, options?: [{ value, label }] }] — options renders requestedValue as
 *     a select instead of free text, for a field that only has a fixed set of valid values
 *     (e.g. Finance's government_employment_status, which is DB-constrained to a small enum).
 *   titleKey
 */
export default function CorrectionsPanel({ departmentKey, officerRoleKey, fields, titleKey }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = [officerRoleKey, 'system_administrator'].includes(user.roleKey);
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ fieldName: fields[0].name, currentValue: '', requestedValue: '', reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() { api.get('/corrections').then((d) => setRows(d.corrections)); }
  useEffect(() => { load(); }, []);

  const selectedField = fields.find((f) => f.name === form.fieldName) || fields[0];

  function onFieldChange(name) {
    setForm((f) => ({ ...f, fieldName: name, requestedValue: '' }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api.post('/corrections', { departmentKey, ...form });
      setForm({ fieldName: fields[0].name, currentValue: '', requestedValue: '', reason: '' });
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function decide(id, approve) {
    await api.post(`/corrections/${id}/decide`, { approve });
    load();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t(titleKey)}</h1>

      {!isOfficer && (
        <form onSubmit={onSubmit} className="card mb-8" noValidate>
          <h2 className="mb-4 font-semibold text-slate-800">{t('correction.formTitle')}</h2>
          {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
          <FormField label={t('correction.field')} htmlFor="field" required>
            <select id="field" className="form-input" value={form.fieldName} onChange={(e) => onFieldChange(e.target.value)}>
              {fields.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
            </select>
          </FormField>
          <FormField label={t('correction.currentValue')} htmlFor="current" help={t('correction.currentValueHelp')}>
            <input id="current" className="form-input" value={form.currentValue} onChange={(e) => setForm((f) => ({ ...f, currentValue: e.target.value }))} />
          </FormField>
          <FormField label={t('correction.requestedValue')} htmlFor="requested" required>
            {selectedField.options ? (
              <select id="requested" required className="form-input" value={form.requestedValue} onChange={(e) => setForm((f) => ({ ...f, requestedValue: e.target.value }))}>
                <option value="">—</option>
                {selectedField.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input id="requested" required className="form-input" value={form.requestedValue} onChange={(e) => setForm((f) => ({ ...f, requestedValue: e.target.value }))} />
            )}
          </FormField>
          <FormField label={t('correction.reason')} htmlFor="reason" required>
            <textarea id="reason" required rows={3} className="form-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </FormField>
          <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('correction.submit')}</button>
        </form>
      )}

      {rows && (
        <DataTable
          rowKey="correction_id"
          rows={rows}
          columns={[
            ...(isOfficer ? [{ key: 'name', header: t('common.citizen'), render: (r) => `${r.first_name} ${r.last_name}` }] : []),
            { key: 'field_name', header: t('correction.field'), render: (r) => (fields.find((f) => f.name === r.field_name)?.label) || r.field_name.replace(/_/g, ' ') },
            { key: 'requested_value', header: t('correction.requestedValue'), render: (r) => (fields.find((f) => f.name === r.field_name)?.options?.find((o) => o.value === r.requested_value)?.label) || r.requested_value },
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
