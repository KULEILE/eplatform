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
 *           extraFields?: [{ name, label, type, required, options, help, defaultValue }]
 *                         | (serviceType) => [...] (same shape — a function when the fields a
 *                            citizen needs genuinely differ by which serviceType they picked above,
 *                            e.g. a renewal needing a previous-permit/disc number a first
 *                            application doesn't; re-evaluated whenever the selected serviceType
 *                            changes, so the form only ever shows/requires what that type needs),
 *           transitions: { [status]: { action, labelKey, requiresText?, textLabelKey? } | [...] }
 *                         | (record) => (same shape for that one record) — a function when which
 *                           action applies depends on more than the bare status (e.g. a Vehicle
 *                           Registration's next action at 'Documents Checked' differs between an
 *                           imported and a local registration — see VehicleRegistration.jsx),
 *           responseField?: { column, labelKey },
 *           formNotice?: string (an already-translated advisory shown at the top of the citizen's
 *             apply form, above the fields — e.g. "you must bring the vehicle in person") }
 *           eligibilityCheck?: { fieldName, url, paramName? } — when set, the apply form watches
 *             form[fieldName] and, 600ms after the citizen stops typing a non-empty value, calls
 *             GET `${url}?${paramName || fieldName}=<value>` (e.g. Public Driving Permit's age/
 *             licence-tenure check — see PublicDrivingPermit.jsx and traffic.controller.js's
 *             getPdpEligibility) expecting back `{ eligible: true|false|null, reason? }`. The
 *             result renders as an inline banner right below the fields, and Submit stays disabled
 *             until it comes back eligible — a citizen can't submit an application the backend is
 *             just going to reject anyway, and finds out why before wasting the trip.
 *
 * A transition option with `requiresText: true` (e.g. 'respond-complaint', 'respond-enquiry' —
 * actions whose controller-side `extra()` requires a non-empty `officerResponse` in the request
 * body) opens a small text-entry modal instead of firing immediately, and posts
 * `{ officerResponse: <text> }` as the action's body — the same reason/confirm shape already used
 * for reject/request-information below, just with its own field name and label.
 *
 * Field types: 'text' | 'textarea' | 'select' | 'date' | 'photo' | 'biometric' | 'office'.
 * 'photo' and 'biometric' render the real capture components (not a text input) and store the
 * uploaded reference string. 'office' renders the district/branch picker and stores an officeId.
 *
 * Every row has a "View details" action opening a read-only modal with every extraField's
 * current value, plus rejection_reason when the record was rejected and `config.responseField`
 * (e.g. an officer's written reply to a complaint or enquiry) when that column is set — list()
 * already returns every column via `SELECT *`/`SELECT t.*`, so this needs no extra request.
 */
export default function DepartmentServicePage({ config }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = user.roleKey === config.officerRoleKey || user.roleKey === 'system_administrator';
  const idColumn = config.idColumn;
  // extraFields can be a plain array or a (serviceType) => array function — see the config doc
  // comment above. resolveFields always takes the serviceType explicitly rather than closing over
  // the `serviceType` state, because three different call sites below each need it resolved
  // against a DIFFERENT type: the apply form against the currently-selected one, but the resubmit
  // and view-details modals against whichever past RECORD they're showing, which may well be a
  // different type than whatever the dropdown happens to say right now.
  const resolveFields = (type) => (typeof config.extraFields === 'function' ? config.extraFields(type) : (config.extraFields || []));

  const [records, setRecords] = useState(null);
  const [serviceType, setServiceType] = useState(config.serviceTypes[0]);
  const extraFields = resolveFields(serviceType);
  const [form, setForm] = useState(() => emptyFormFromFields(extraFields));
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [modal, setModal] = useState(null); // { record, kind: 'reject' | 'request-information' }
  const [reason, setReason] = useState('');
  const [responseModal, setResponseModal] = useState(null); // { record, action, textLabelKey }
  const [responseText, setResponseText] = useState('');
  const [resubmitTarget, setResubmitTarget] = useState(null);
  const [resubmitForm, setResubmitForm] = useState(null);
  const [viewRecord, setViewRecord] = useState(null);
  // eligibilityCheck — see the config doc comment above. status: 'idle' | 'checking' | 'eligible' | 'ineligible' | 'error'.
  const [eligibility, setEligibility] = useState({ status: 'idle', reason: '' });

  function load() { api.get(`${config.apiBase}/`).then((d) => setRecords(d.records)); }
  useEffect(() => { load(); }, []);

  const eligibilityValue = config.eligibilityCheck ? form[config.eligibilityCheck.fieldName] : null;
  useEffect(() => {
    if (!config.eligibilityCheck) return;
    if (!eligibilityValue) { setEligibility({ status: 'idle', reason: '' }); return; }
    setEligibility({ status: 'checking', reason: '' });
    const { url, fieldName, paramName } = config.eligibilityCheck;
    const timer = setTimeout(() => {
      api.get(`${url}?${paramName || fieldName}=${encodeURIComponent(eligibilityValue)}`)
        .then((d) => {
          if (d.eligible === true) setEligibility({ status: 'eligible', reason: '' });
          else if (d.eligible === false) setEligibility({ status: 'ineligible', reason: d.reason || '' });
          else setEligibility({ status: 'idle', reason: '' });
        })
        .catch((err) => setEligibility({ status: 'error', reason: err.message || '' }));
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibilityValue]);

  // Only relevant when extraFields is the function form: switching serviceType can change which
  // fields exist at all, so a value left over from the previous selection (a previousPermitNumber
  // typed in under 'Renewal', say, then switching to 'New') is cleared rather than silently
  // carried along and posted anyway.
  useEffect(() => { if (typeof config.extraFields === 'function') setForm(emptyFormFromFields(extraFields)); }, [serviceType]);

  function updateField(name, value) { setForm((f) => ({ ...f, [name]: value })); }
  const missingRequired = extraFields.some((f) => f.required && !form[f.name])
    || (!!config.eligibilityCheck && eligibility.status !== 'eligible');

  async function apply(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      await api.post(`${config.apiBase}/apply`, { serviceType, ...form });
      setSuccess(t('services.submitted'));
      setForm(emptyFormFromFields(extraFields));
      if (config.eligibilityCheck) setEligibility({ status: 'idle', reason: '' });
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

  async function submitResponseModal() {
    setBusyId(responseModal.record[idColumn]);
    try {
      await api.post(`${config.apiBase}/${responseModal.record[idColumn]}/${responseModal.action}`, { officerResponse: responseText });
      setResponseModal(null);
      setResponseText('');
      load();
    } finally {
      setBusyId(null);
    }
  }

  function startResubmit(record) {
    setResubmitTarget(record[idColumn]);
    // This record's OWN service_type, not whatever the apply form's dropdown currently has
    // selected — those can legitimately differ (e.g. resubmitting a 'Renewal' while the form
    // above still shows 'New').
    const prefilled = {};
    resolveFields(record.service_type).forEach((f) => { prefilled[f.name] = record[toSnakeCase(f.name)] ?? ''; });
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
          {config.formNotice && <p className="mb-4 w-full rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">ℹ {config.formNotice}</p>}

          {config.serviceTypes.length > 1 && (
            <FormField label={t(`${config.serviceTypeNs}.serviceType`)} htmlFor="serviceType">
              <select id="serviceType" className="form-input" value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                {config.serviceTypes.map((s) => <option key={s} value={s}>{t(`${config.serviceTypeNs}.${s}`)}</option>)}
              </select>
            </FormField>
          )}

          <FieldInputs fields={extraFields} form={form} onChange={updateField} departmentKey={config.departmentKey || 'traffic'} />

          {config.eligibilityCheck && eligibility.status === 'checking' && (
            <p className="mb-4 w-full rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600" role="status">{t('common.checking')}</p>
          )}
          {config.eligibilityCheck && eligibility.status === 'ineligible' && (
            <p className="mb-4 w-full rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {eligibility.reason}</p>
          )}
          {config.eligibilityCheck && eligibility.status === 'eligible' && (
            <p className="mb-4 w-full rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {t('common.eligibilityConfirmed')}</p>
          )}
          {config.eligibilityCheck && eligibility.status === 'error' && (
            <p className="mb-4 w-full rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {t('common.somethingWentWrong')}</p>
          )}

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
          {
            key: 'view', header: '',
            render: (r) => <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => setViewRecord(r)}>{t('common.viewDetails')}</button>,
          },
          ...(isOfficer ? [{
            key: 'actions', header: t('common.actions'),
            render: (r) => {
              // transitions can be a plain { status: option } object, or — when which action
              // applies depends on more than just the status (e.g. Vehicle Registration's customs
              // step only applies to an imported registration, not a local one) — a function of
              // the record itself. See config doc comment above.
              const rawNext = typeof config.transitions === 'function' ? config.transitions(r) : config.transitions[r.status];
              const nextOptions = rawNext ? (Array.isArray(rawNext) ? rawNext : [rawNext]) : [];
              const busy = busyId === r[idColumn];
              return (
                <div className="flex flex-wrap gap-2">
                  {nextOptions.map((opt) => (
                    <button key={opt.action} type="button" disabled={busy} className="text-sm font-medium text-gov-navy hover:underline"
                      onClick={() => opt.requiresText ? setResponseModal({ record: r, action: opt.action, textLabelKey: opt.textLabelKey }) : transition(r, opt.action)}>
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

      <Modal
        open={!!responseModal}
        onClose={() => setResponseModal(null)}
        title={t('common.respond')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setResponseModal(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn-primary" disabled={!responseText.trim() || busyId === responseModal?.record?.[idColumn]} onClick={submitResponseModal}>{t('common.confirm')}</button>
          </>
        }
      >
        <label htmlFor="modalResponseText" className="form-label">{responseModal ? t(responseModal.textLabelKey) : ''}</label>
        <textarea id="modalResponseText" className="form-input" rows={4} value={responseText} onChange={(e) => setResponseText(e.target.value)} />
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
            <FieldInputs
              fields={resolveFields(records?.find((r) => r[idColumn] === resubmitTarget)?.service_type)}
              form={resubmitForm} onChange={(name, value) => setResubmitForm((f) => ({ ...f, [name]: value }))}
              departmentKey={config.departmentKey || 'traffic'}
            />
          </form>
        )}
      </Modal>

      <Modal open={!!viewRecord} onClose={() => setViewRecord(null)} title={t('common.viewDetails')}
        footer={<button type="button" className="btn-secondary" onClick={() => setViewRecord(null)}>{t('common.close')}</button>}
      >
        {viewRecord && (
          <dl className="space-y-3 text-sm">
            <ViewRow label={t('applications.reference')} value={viewRecord.application_reference} mono />
            <ViewRow label={t(`${config.serviceTypeNs}.serviceType`)} value={t(`${config.serviceTypeNs}.${viewRecord.service_type}`)} />
            <ViewRow label={t('common.status')} value={<StatusBadge status={viewRecord.status} />} />
            {resolveFields(viewRecord.service_type).map((f) => {
              const raw = viewRecord[toSnakeCase(f.name)];
              if (raw === null || raw === undefined || raw === '') return null;
              if (f.type === 'photo' || f.type === 'biometric') return null; // shown as a reference string, not useful to print raw
              const display = f.type === 'select' ? (f.options.find((o) => o.value === raw)?.label ?? raw) : String(raw);
              return <ViewRow key={f.name} label={f.label} value={display} />;
            })}
            {config.responseField && viewRecord[config.responseField.column] && (
              <ViewRow label={t(config.responseField.labelKey)} value={viewRecord[config.responseField.column]} />
            )}
            {viewRecord.status === 'Rejected' && viewRecord.rejection_reason && (
              <ViewRow label={t('common.reason')} value={viewRecord.rejection_reason} />
            )}
          </dl>
        )}
      </Modal>
    </div>
  );
}

function toSnakeCase(name) {
  return name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function ViewRow({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-slate-900">{value}</dd>
    </div>
  );
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
