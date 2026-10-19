import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from './ui/Loading';
import DataTable from './ui/DataTable';
import StatusBadge from './ui/StatusBadge';
import Modal from './ui/Modal';
import FormField from './ui/FormField';
import PhotoCapture from './PhotoCapture';
import BiometricCapture from './BiometricCapture';
import DistrictOfficeSelect from './DistrictOfficeSelect';

/**
 * Shared UI for the "breadth" departments whose backend uses the generic
 * simpleDepartmentController factory (Traffic, Finance, Pensions, and Traffic's inspections/
 * transport-permits sub-resources). Citizens apply and track; officers work a queue with the
 * department's configured status transitions.
 *
 * Originally this only ever asked for a bare serviceType — every one of Traffic's new service
 * types needs real supporting information (a photo, a fingerprint scan, a vehicle's chassis
 * number, proof of insurance...), so `config.extraFields` now describes that information the
 * same way ServiceWorkflowPage's `fields` do, and this renders + requires it before the citizen
 * can submit, and lets them fix it up and resubmit if an officer asks for more information.
 *
 * config: { apiBase, idColumn, titleKey, serviceTypes: string[], serviceTypeNs, officerRoleKey,
 *           departmentKey (for 'office'-type fields, defaults to 'traffic'),
 *           extraFields?: [{ name, label, type, required, options, help, defaultValue }],
 *           transitions: { [status]: { action, labelKey } | [{ action, labelKey }] } }
 *
 * Field types: 'text' | 'textarea' | 'select' | 'date' | 'photo' | 'biometric' | 'office'.
 * 'photo' and 'biometric' render the real capture components (not a text input) and store the
 * uploaded reference string. 'office' renders the district/branch picker and stores an officeId.
 */
export default function DepartmentServicePage({ config }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = user.roleKey === config.officerRoleKey || user.roleKey === 'system_administrator';
  const extraFields = config.extraFields || [];
  const idColumn = config.idColumn;

  const [records, setRecords] = useState(null);
  const [serviceType, setServiceType] = useState(config.serviceTypes[0]);
  const [form, setForm] = useState(() => emptyFormFromFields(extraFields));
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [modal, setModal] = useState(null); // { record, kind: 'reject' | 'request-information' }
  const [reason, setReason] = useState('');
  const [resubmitTarget, setResubmitTarget] = useState(null);
  const [resubmitForm, setResubmitForm] = useState(null);

  function load() { api.get(`${config.apiBase}/`).then((d) => setRecords(d.records)); }
  useEffect(() => { load(); }, []);

  function updateField(name, value) { setForm((f) => ({ ...f, [name]: value })); }
  const missingRequired = extraFields.some((f) => f.required && !form[f.name]);

  async function apply(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await api.post(`${config.apiBase}/apply`, { serviceType, ...form });
      setSuccess(t('services.submitted'));
      setForm(emptyFormFromFields(extraFields));
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    }
  }

  async function transition(record, action) {
    setBusyId(record[idColumn]);
    try {
      await api.post(`${config.apiBase}/${record[idColumn]}/${action}`, {});
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function submitModal() {
    await api.post(`${config.apiBase}/${modal.record[idColumn]}/${modal.kind}`, { reason });
    setModal(null);
    setReason('');
    load();
  }

  function startResubmit(record) {
    setResubmitTarget(record[idColumn]);
    const prefilled = {};
    extraFields.forEach((f) => { prefilled[f.name] = record[toSnakeCase(f.name)] ?? ''; });
    setResubmitForm(prefilled);
    setError(''); setSuccess('');
  }

  async function onResubmit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await api.post(`${config.apiBase}/${resubmitTarget}/resubmit`, resubmitForm);
      setSuccess(t('services.resubmitted'));
      setResubmitTarget(null); setResubmitForm(null);
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    }
  }

  if (!records) return <Loading />;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t(config.titleKey)}</h1>

      {!isOfficer && (
        <form onSubmit={apply} className="card mb-8" noValidate>
          {error && <p className="mb-4 w-full rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
          {success && <p className="mb-4 w-full rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

          {config.serviceTypes.length > 1 && (
            <FormField label={t(`${config.serviceTypeNs}.serviceType`)} htmlFor="serviceType">
              <select id="serviceType" className="form-input" value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                {config.serviceTypes.map((s) => <option key={s} value={s}>{t(`${config.serviceTypeNs}.${s}`)}</option>)}
              </select>
            </FormField>
          )}

          <FieldInputs fields={extraFields} form={form} onChange={updateField} departmentKey={config.departmentKey || 'traffic'} />

          <button type="submit" disabled={missingRequired} className="btn-primary">{t(`${config.serviceTypeNs}.apply`)}</button>
        </form>
      )}

      <DataTable
        rowKey={idColumn}
        rows={records}
        columns={[
          { key: 'application_reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.application_reference}</span> },
          ...(isOfficer ? [{ key: 'name', header: t('common.citizen'), render: (r) => `${r.first_name} ${r.last_name}` }] : []),
          { key: 'service_type', header: t(`${config.serviceTypeNs}.serviceType`), render: (r) => t(`${config.serviceTypeNs}.${r.service_type}`) },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          ...(isOfficer ? [{
            key: 'actions', header: t('common.actions'),
            render: (r) => {
              const rawNext = config.transitions[r.status];
              const nextOptions = rawNext ? (Array.isArray(rawNext) ? rawNext : [rawNext]) : [];
              const busy = busyId === r[idColumn];
              return (
                <div className="flex flex-wrap gap-2">
                  {nextOptions.map((opt) => (
                    <button key={opt.action} type="button" disabled={busy} className="text-sm font-medium text-gov-navy hover:underline" onClick={() => transition(r, opt.action)}>
                      {t(opt.labelKey)}
                    </button>
                  ))}
                  {!['Rejected', 'Completed', 'Collected'].includes(r.status) && (
                    <>
                      <button type="button" className="text-sm font-medium text-slate-500 hover:underline" onClick={() => setModal({ record: r, kind: 'request-information' })}>{t('common.requestInformation')}</button>
                      <button type="button" className="text-sm font-medium text-gov-red hover:underline" onClick={() => setModal({ record: r, kind: 'reject' })}>{t('common.reject')}</button>
                    </>
                  )}
                </div>
              );
            },
          } ] : [{
            key: 'citizenActions', header: t('common.actions'),
            render: (r) => r.status === 'Additional Information Required' ? (
              <button type="button" className="text-xs font-semibold text-gov-navy underline" onClick={() => startResubmit(r)}>
                {t('common.editAndResubmit')}
              </button>
            ) : null,
          }]),
        ]}
      />

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.kind === 'reject' ? t('common.reject') : t('common.requestInformation')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
            <button type="button" className={modal?.kind === 'reject' ? 'btn-danger' : 'btn-primary'} disabled={!reason.trim()} onClick={submitModal}>{t('common.confirm')}</button>
          </>
        }
      >
        <label htmlFor="modalReason" className="form-label">{t('common.reason')}</label>
        <textarea id="modalReason" className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>

      <Modal open={!!resubmitTarget} onClose={() => setResubmitTarget(null)} title={t('common.editAndResubmit')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setResubmitTarget(null)}>{t('common.cancel')}</button>
            <button type="submit" form="dept-resubmit-form" className="btn-primary">{t('common.resubmitForReview')}</button>
          </>
        }
      >
        {resubmitForm && (
          <form id="dept-resubmit-form" onSubmit={onResubmit} noValidate>
            <FieldInputs fields={extraFields} form={resubmitForm} onChange={(name, value) => setResubmitForm((f) => ({ ...f, [name]: value }))} departmentKey={config.departmentKey || 'traffic'} />
          </form>
        )}
      </Modal>
    </div>
  );
}

function toSnakeCase(name) {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function emptyFormFromFields(fields) {
  const form = {};
  fields.forEach((f) => { form[f.name] = f.defaultValue !== undefined ? f.defaultValue : f.type === 'photo' || f.type === 'biometric' ? null : f.type === 'office' ? '' : ''; });
  return form;
}

function FieldInputs({ fields, form, onChange, departmentKey }) {
  const { t } = useLanguage();
  return (
    <>
      {fields.map((f) => {
        if (f.type === 'photo') {
          return <PhotoCapture key={f.name} value={form[f.name]} onChange={(v) => onChange(f.name, v)} label={f.label} help={f.help} faceCheck={!!f.faceCheck} />;
        }
        if (f.type === 'biometric') {
          // f.name is always one of the *Left/*Right biometric reference fields (see every
          // Traffic form that sets type: 'biometric') — hand is derived from that suffix so each
          // call site doesn't need its own prop for it. enroll defaults to true: every service
          // that uses this generic renderer (National ID, Driving Licence/Permit services) only
          // ever runs for a citizen who already has a citizen_id, so the real hand-geometry
          // template captured here can be self-enrolled immediately (see BiometricCapture.jsx).
          const inferredHand = f.name.toLowerCase().endsWith('left') ? 'left' : 'right';
          return (
            <BiometricCapture
              key={f.name} value={form[f.name]} onChange={(v) => onChange(f.name, v)}
              label={f.label} help={f.help} hand={inferredHand}
              enrollSource={f.enrollSource || t('biometricCapture.genericEnrollSource')}
            />
          );
        }
        if (f.type === 'office') {
          return (
            <DistrictOfficeSelect key={f.name} departmentKey={departmentKey} value={form[f.name]} onChange={(v) => onChange(f.name, v)} />
          );
        }
        return (
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
        );
      })}
    </>
  );
}
