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
import DocumentCapture from './DocumentCapture';
import BackToDepartment from './BackToDepartment';
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
  title, intro, notice, apiBase, idField, listKey, singleKey,
  referenceField, fields, columns = [], resultFields = [],
  initialStatus = 'Submitted', reviewableStatus = 'Under Review',
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);
  return isOfficer
    ? <OfficerQueue t={t} apiBase={apiBase} idField={idField} listKey={listKey} columns={columns} resultFields={resultFields}
        referenceField={referenceField} initialStatus={initialStatus} reviewableStatus={reviewableStatus} title={title} intro={intro} fields={fields} />
    : <CitizenView t={t} apiBase={apiBase} idField={idField} listKey={listKey} singleKey={singleKey} referenceField={referenceField}
        fields={fields} columns={columns} resultFields={resultFields} title={title} intro={intro} notice={notice} />;
}

// fields[].name is camelCase (matches the JS payload the citizen submits); the row data that
// comes back from the database uses the column's own snake_case name. Shared by the citizen's
// resubmit-prefill below and the officer's detail view, so both read a submitted value the same
// way.
function snakeCaseKey(name) {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function formatFieldValueForDisplay(field, row) {
  const raw = row[snakeCaseKey(field.name)];
  if (raw === null || raw === undefined || raw === '') return null;
  if (field.type === 'date') return formatDateOnly(raw);
  if (field.type === 'select' && Array.isArray(field.options)) {
    const match = field.options.find((o) => String(o.value) === String(raw));
    if (match) return match.label;
  }
  return String(raw);
}

/**
 * What an officer sees before approving/rejecting/requesting-more-information used to be just a
 * reference number, the citizen's name, and whatever one extra column that service's page chose
 * to add (e.g. the deceased's name for Burial Order) — never the actual content the citizen
 * submitted (where the burial is planned, the court order reference, the special-licence reason,
 * and so on). The officer was being asked to decide without seeing what they were deciding on.
 * This reuses the same `fields` the citizen's own form is built from, so every service gets this
 * for free — a field can opt out with `hideFromOfficerDetail` when it's an internal lookup ID
 * that's already represented more usefully elsewhere (see deathRecordId in BurialOrder.jsx /
 * DeathCertificateRequest.jsx, where the deceased's name is already its own column).
 */
function DetailModal({ t, open, onClose, row, fields }) {
  const visibleFields = fields.filter((f) => !f.hideFromOfficerDetail);
  return (
    <Modal open={open} onClose={onClose} title={t('common.viewDetails')}
      footer={<button type="button" className="btn-secondary" onClick={onClose}>{t('common.close')}</button>}
    >
      {row && (
        <dl className="space-y-3">
          {visibleFields.map((f) => {
            // A file field's raw value is an opaque file_blobs reference (e.g.
            // "documents/1700000000000-123456789.jpg"), not something to print as text — link to
            // it the same way DocumentCapture's own preview does (see /uploads/* in app.js).
            const raw = row[snakeCaseKey(f.name)];
            return (
              <div key={f.name}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{f.label}</dt>
                <dd className="text-sm text-slate-800">
                  {f.type === 'file'
                    ? (raw
                      ? <a href={`/uploads/${raw}`} target="_blank" rel="noreferrer" className="font-semibold text-gov-navy underline">{t('services.viewDocument')}</a>
                      : t('services.notProvided'))
                    : (formatFieldValueForDisplay(f, row) || t('services.notProvided'))}
                </dd>
              </div>
            );
          })}
          {row.rejection_reason && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('services.reason')}</dt>
              <dd className="text-sm text-gov-red">{row.rejection_reason}</dd>
            </div>
          )}
        </dl>
      )}
    </Modal>
  );
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
      {fields.map((f) => f.type === 'file' ? (
        // DocumentCapture draws its own label/required-marker/help inside its bordered box
        // (same as BirthCertificateApplication.jsx's documents) — wrapping it in FormField too
        // would print the label twice, so it's rendered on its own here instead.
        <DocumentCapture
          key={f.name}
          label={f.label}
          help={f.help}
          required={f.required}
          value={form[f.name] ?? ''}
          onChange={(value) => onChange(f.name, value)}
        />
      ) : (
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

function CitizenView({ t, apiBase, idField, listKey, singleKey, referenceField, fields, columns, resultFields, title, intro, notice }) {
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

  // A required file field (DocumentCapture) has no native HTML "required" enforcement the way
  // a required text/select/textarea input does inside this <form> — it's its own file input with
  // no `required` attribute, driven entirely by this component's own state. Checked explicitly
  // here so a missing required document is caught before the request is sent, the same as a
  // missing required text field already is by the browser.
  function missingRequiredFile(fieldsToCheck, formToCheck) {
    return fieldsToCheck.find((f) => f.type === 'file' && f.required && !formToCheck[f.name]);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    const missing = missingRequiredFile(fields, form);
    if (missing) { setError(t('services.fieldRequired', { field: missing.label })); return; }
    setBusy(true);
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
    resubmitFields.forEach((f) => { prefilled[f.name] = row[snakeCaseKey(f.name)] ?? ''; });
    setResubmitForm(prefilled);
    setError(''); setSuccess('');
  }

  async function onResubmit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    const missing = missingRequiredFile(resubmitFields, resubmitForm);
    if (missing) { setError(t('services.fieldRequired', { field: missing.label })); return; }
    setBusy(true);
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
      <BackToDepartment />
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mb-6 text-sm text-slate-600">{intro}</p>
      {notice && <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">ℹ {notice}</p>}

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

function OfficerQueue({ t, apiBase, idField, listKey, columns, resultFields, referenceField, initialStatus, reviewableStatus, title, intro, fields }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(null);
  const [reasonTarget, setReasonTarget] = useState(null); // { id, action: 'request-information'|'reject' }
  const [reason, setReason] = useState('');
  const [detailRow, setDetailRow] = useState(null); // the row currently shown in the "View details" modal, or null

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
          <button type="button" className="text-xs font-semibold text-slate-600 underline" onClick={() => setDetailRow(r)}>
            {t('common.viewDetails')}
          </button>
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
      <BackToDepartment />
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

      <DetailModal t={t} open={!!detailRow} onClose={() => setDetailRow(null)} row={detailRow} fields={fields} />
    </div>
  );
}
