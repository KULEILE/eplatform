import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from './ui/Loading';
import DataTable from './ui/DataTable';
import StatusBadge from './ui/StatusBadge';
import FormField from './ui/FormField';
import Modal from './ui/Modal';
import { formatDateOnly } from '../utils/format';

/**
 * Shared page for the seven new Home Affairs services that all follow the same shape:
 * citizen submits -> officer reviews -> officer may request more information -> citizen
 * resubmits -> officer approves or rejects. Mirrors the backend's buildTransition() helper
 * (utils/workflow.js) the same way — one implementation instead of seven near-identical ones.
 *
 * Each service's page (BirthCertificateReissue.jsx, DeathCertificateRequest.jsx, NameChange.jsx,
 * Adoption.jsx, BurialOrder.jsx, SpecialMarriageLicence.jsx) is a thin wrapper that supplies the
 * `fields` for its own submit/resubmit form and a handful of extra DataTable columns.
 *
 * Services with a genuinely different action set (marriage solemnisation booking, which uses
 * confirm/complete/cancel instead of approve/reject) are NOT built on this component — see
 * MarriageSolemnisation.jsx.
 */
export default function ServiceWorkflowPage({
  title, intro, apiBase, idField, listKey, singleKey,
  referenceField, fields, columns = [], resultFields = [],
  initialStatus = 'Submitted', reviewableStatus = 'Under Review',
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);
  return isOfficer
    ? <OfficerQueue t={t} apiBase={apiBase} idField={idField} listKey={listKey} columns={columns} resultFields={resultFields}
        referenceField={referenceField} initialStatus={initialStatus} reviewableStatus={reviewableStatus} title={title} intro={intro} />
    : <CitizenView t={t} apiBase={apiBase} idField={idField} listKey={listKey} singleKey={singleKey} referenceField={referenceField}
        fields={fields} columns={columns} resultFields={resultFields} title={title} intro={intro} />;
}

function renderResultFields(resultFields, row) {
  const parts = resultFields
    .map((rf) => {
      const value = row[rf.field];
      if (!value) return null;
      if (rf.linkTo) return <Link key={rf.field} to={rf.linkTo(value, row)} className="font-semibold text-gov-navy underline">{rf.label}</Link>;
      return <span key={rf.field}>{rf.label}: {value}</span>;
    })
    .filter(Boolean);
  if (parts.length === 0) return null;
  return <div className="flex flex-wrap gap-2 text-xs text-slate-500">{parts}</div>;
}

function emptyFormFromFields(fields) {
  const form = {};
  fields.forEach((f) => { form[f.name] = f.defaultValue !== undefined ? f.defaultValue : ''; });
  return form;
}

function FieldInputs({ fields, form, onChange }) {
  return (
    <>
      {fields.map((f) => (
        <FormField key={f.name} label={f.label} htmlFor={f.name} required={f.required} help={f.help}>
          {f.type === 'textarea' ? (
            <textarea id={f.name} required={f.required} rows={3} className="form-input"
              value={form[f.name] ?? ''} onChange={(e) => onChange(f.name, e.target.value)} />
          ) : f.type === 'select' ? (
            <select id={f.name} required={f.required} className="form-input"
              value={form[f.name] ?? ''} onChange={(e) => onChange(f.name, e.target.value)}>
              <option value="">{f.placeholder || '—'}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input id={f.name} type={f.type || 'text'} required={f.required} className="form-input"
              value={form[f.name] ?? ''} onChange={(e) => onChange(f.name, e.target.value)} />
          )}
        </FormField>
      ))}
    </>
  );
}

function CitizenView({ t, apiBase, idField, listKey, singleKey, referenceField, fields, columns, resultFields, title, intro }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(() => emptyFormFromFields(fields));
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [resubmitTarget, setResubmitTarget] = useState(null);
  const [resubmitForm, setResubmitForm] = useState(null);

  function load() { api.get(apiBase).then((d) => setRows(d[listKey])).catch(() => setRows([])); }
  useEffect(() => { load(); }, []);

  function update(name, value) { setForm((f) => ({ ...f, [name]: value })); }

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setBusy(true);
    try {
      const result = await api.post(apiBase, form);
      const ref = result[singleKey]?.[referenceField];
      setSuccess(ref ? t('services.submittedWithReference', { reference: ref }) : t('services.submitted'));
      setForm(emptyFormFromFields(fields));
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  const resubmitFields = fields.filter((f) => !f.omitOnResubmit);

  function startResubmit(row) {
    setResubmitTarget(row[idField]);
    const prefilled = {};
    resubmitFields.forEach((f) => { prefilled[f.name] = row[f.name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] ?? ''; });
    setResubmitForm(prefilled);
    setError(''); setSuccess('');
  }

  async function onResubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setBusy(true);
    try {
      await api.post(`${apiBase}/${resubmitTarget}/resubmit`, resubmitForm);
      setSuccess(t('services.resubmitted'));
      setResubmitTarget(null); setResubmitForm(null);
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  const tableColumns = [
    { key: 'reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r[referenceField]}</span> },
    ...columns,
    { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
    { key: 'requested_at', header: t('services.submittedAt'), render: (r) => formatDateOnly(r.requested_at) },
    {
      key: 'actions', header: t('common.actions'),
      render: (r) => ['Additional Information Required', 'Rejected'].includes(r.status) ? (
        <button type="button" className="text-xs font-semibold text-gov-navy underline" onClick={() => startResubmit(r)}>
          {t('common.editAndResubmit')}
        </button>
      ) : r.status === 'Approved' ? renderResultFields(resultFields, r) : null,
    },
  ];

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mb-6 text-sm text-slate-600">{intro}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      <form onSubmit={onSubmit} className="card mb-8" noValidate>
        <FieldInputs fields={fields} form={form} onChange={update} />
        <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('common.submit')}</button>
      </form>

      <h2 className="mb-3 text-lg font-semibold text-slate-900">{t('services.myRequests')}</h2>
      {!rows ? <Loading /> : <DataTable rowKey={idField} rows={rows} columns={tableColumns} emptyTitle={t('common.noResults')} />}

      <Modal open={!!resubmitTarget} onClose={() => setResubmitTarget(null)} title={t('common.editAndResubmit')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setResubmitTarget(null)}>{t('common.cancel')}</button>
            <button type="submit" form="resubmit-form" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('common.resubmitForReview')}</button>
          </>
        }
      >
        {resubmitForm && (
          <form id="resubmit-form" onSubmit={onResubmit} noValidate>
            <FieldInputs fields={resubmitFields} form={resubmitForm} onChange={(name, value) => setResubmitForm((f) => ({ ...f, [name]: value }))} />
          </form>
        )}
      </Modal>
    </div>
  );
}

function OfficerQueue({ t, apiBase, idField, listKey, columns, resultFields, referenceField, initialStatus, reviewableStatus, title, intro }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(null);
  const [reasonTarget, setReasonTarget] = useState(null); // { id, action: 'request-information'|'reject' }
  const [reason, setReason] = useState('');

  function load() { api.get(apiBase).then((d) => setRows(d[listKey])).catch(() => setRows([])); }
  useEffect(() => { load(); }, []);

  async function act(id, action, body) {
    setError(''); setSuccess(''); setBusy(id);
    try {
      await api.post(`${apiBase}/${id}/${action}`, body);
      setSuccess(t('services.actionRecorded'));
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(null); }
  }

  async function onReasonSubmit(e) {
    e.preventDefault();
    if (!reasonTarget) return;
    await act(reasonTarget.id, reasonTarget.action, { reason });
    setReasonTarget(null); setReason('');
  }

  const tableColumns = [
    { key: 'reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r[referenceField]}</span> },
    { key: 'citizen', header: t('common.citizen'), render: (r) => `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—' },
    ...columns,
    { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions', header: t('common.actions'),
      render: (r) => (
        <div className="flex flex-wrap gap-2">
          {r.status === initialStatus && (
            <button type="button" disabled={busy === r[idField]} className="text-xs font-semibold text-gov-navy underline"
              onClick={() => act(r[idField], 'start-review')}>{t('services.startReview')}</button>
          )}
          {r.status === reviewableStatus && (
            <>
              <button type="button" disabled={busy === r[idField]} className="text-xs font-semibold text-gov-amber underline"
                onClick={() => setReasonTarget({ id: r[idField], action: 'request-information' })}>{t('services.requestInfo')}</button>
              <button type="button" disabled={busy === r[idField]} className="text-xs font-semibold text-gov-green underline"
                onClick={() => act(r[idField], 'approve')}>{t('common.approve')}</button>
              <button type="button" disabled={busy === r[idField]} className="text-xs font-semibold text-gov-red underline"
                onClick={() => setReasonTarget({ id: r[idField], action: 'reject' })}>{t('common.reject')}</button>
            </>
          )}
          {r.status === 'Approved' && renderResultFields(resultFields, r)}
        </div>
      ),
    },
  ];

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mb-6 text-sm text-slate-600">{intro}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      {!rows ? <Loading /> : <DataTable rowKey={idField} rows={rows} columns={tableColumns} emptyTitle={t('common.noResults')} />}

      <Modal open={!!reasonTarget} onClose={() => setReasonTarget(null)}
        title={reasonTarget?.action === 'reject' ? t('common.reject') : t('services.requestInfo')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReasonTarget(null)}>{t('common.cancel')}</button>
            <button type="submit" form="reason-form" className="btn-primary">{t('common.submit')}</button>
          </>
        }
      >
        <form id="reason-form" onSubmit={onReasonSubmit} noValidate>
          <FormField label={t('services.reason')} htmlFor="reason" required>
            <textarea id="reason" required rows={3} className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
