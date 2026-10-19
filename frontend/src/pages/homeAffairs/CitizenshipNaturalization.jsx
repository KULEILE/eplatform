import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import Modal from '../../components/ui/Modal';
import FormField from '../../components/ui/FormField';
import PhotoCapture from '../../components/PhotoCapture';
import ReceiptCapture from '../../components/ReceiptCapture';
import BiometricCapture from '../../components/BiometricCapture';
import { formatDateOnly } from '../../utils/format';

const SEX_OPTIONS = ['Male', 'Female', 'Other', 'Unspecified'];
const TRAVEL_DOCUMENT_TYPES = ['Passport', 'Refugee Travel Document', 'Other'];
const IMMIGRATION_STATUSES = ['Refugee', 'Asylum Seeker', 'Work Permit Holder', 'Study Permit Holder', 'Permanent Resident', 'Other'];

function emptyForm() {
  return {
    firstName: '', middleName: '', lastName: '', dateOfBirth: '', placeOfBirth: '',
    sex: '', nationality: '', travelDocumentType: '', travelDocumentNumber: '',
    immigrationStatus: '', arrivalDate: '',
  };
}

/**
 * Citizenship by Naturalization (migration 051) — a self-contained Home Affairs service, built
 * as its own bespoke page rather than on ServiceWorkflowPage, because that shared component's
 * FieldInputs only supports text/number/date/select/textarea fields and this form needs three
 * file-style captures (ID photo, chief's letter, fee receipt) — see PhotoCapture/ReceiptCapture
 * below, the same pattern Passport.jsx uses.
 *
 * Only a foreign-national account (users.is_foreign_national, no citizen_id yet) can apply —
 * see naturalization.controller.js. Approval creates a new citizens row and links this account
 * to it, which is the moment the rest of the system unlocks for this user.
 */
export default function CitizenshipNaturalization() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);
  const isForeignNational = user.roleKey === 'citizen' && !!user.isForeignNational;

  if (!isOfficer && !isForeignNational) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.naturalization')}</h1>
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">ℹ {t('homeAffairs.naturalizationForm.notApplicable')}</p>
      </div>
    );
  }

  return isOfficer ? <OfficerQueue t={t} /> : <ApplicantView t={t} />;
}

function useSyncCitizenAccessAfterApproval(rows) {
  // The officer who approves an application and the applicant viewing this page are two
  // different browser sessions — approval happens on the SERVER, but the applicant's own
  // AuthContext `user` (and therefore every nav/access check derived from it, e.g.
  // Dashboard.jsx and HomeAffairsHub.jsx) only reflects what was loaded at their last login or
  // page load. Without this, an applicant whose application was just approved would see
  // "Approved" right here, yet still find every other Home Affairs service hidden until they
  // happened to log out and back in. As soon as this page sees its own "Approved" row while the
  // cached user still shows no citizenId, it refreshes the shared auth state so the rest of the
  // app picks up full access immediately — no logout required.
  const { user, refresh } = useAuth();
  useEffect(() => {
    if (!rows || user.citizenId) return;
    if (rows.some((r) => r.status === 'Approved')) refresh();
  }, [rows, user.citizenId, refresh]);
}

function FieldGrid({ t, form, onChange, idPrefix = '' }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
        <FormField label={t('homeAffairs.naturalizationForm.field.firstName')} htmlFor={`${idPrefix}firstName`} required>
          <input id={`${idPrefix}firstName`} required className="form-input" value={form.firstName} onChange={(e) => onChange('firstName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.naturalizationForm.field.middleName')} htmlFor={`${idPrefix}middleName`} help={t('common.optional')}>
          <input id={`${idPrefix}middleName`} className="form-input" value={form.middleName} onChange={(e) => onChange('middleName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.naturalizationForm.field.lastName')} htmlFor={`${idPrefix}lastName`} required>
          <input id={`${idPrefix}lastName`} required className="form-input" value={form.lastName} onChange={(e) => onChange('lastName', e.target.value)} />
        </FormField>
      </div>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
        <FormField label={t('homeAffairs.naturalizationForm.field.dateOfBirth')} htmlFor={`${idPrefix}dateOfBirth`} required>
          <input id={`${idPrefix}dateOfBirth`} type="date" required className="form-input" value={form.dateOfBirth} onChange={(e) => onChange('dateOfBirth', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.naturalizationForm.field.placeOfBirth')} htmlFor={`${idPrefix}placeOfBirth`} help={t('common.optional')}>
          <input id={`${idPrefix}placeOfBirth`} className="form-input" value={form.placeOfBirth} onChange={(e) => onChange('placeOfBirth', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.naturalizationForm.field.sex')} htmlFor={`${idPrefix}sex`} required>
          <select id={`${idPrefix}sex`} required className="form-input" value={form.sex} onChange={(e) => onChange('sex', e.target.value)}>
            <option value="">—</option>
            {SEX_OPTIONS.map((s) => <option key={s} value={s}>{t(`homeAffairs.naturalizationForm.${s.toLowerCase()}`)}</option>)}
          </select>
        </FormField>
      </div>
      <FormField label={t('homeAffairs.naturalizationForm.field.nationality')} htmlFor={`${idPrefix}nationality`} required>
        <input id={`${idPrefix}nationality`} required className="form-input" value={form.nationality} onChange={(e) => onChange('nationality', e.target.value)} />
      </FormField>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <FormField label={t('homeAffairs.naturalizationForm.field.travelDocumentType')} htmlFor={`${idPrefix}travelDocumentType`} required>
          <select id={`${idPrefix}travelDocumentType`} required className="form-input" value={form.travelDocumentType} onChange={(e) => onChange('travelDocumentType', e.target.value)}>
            <option value="">—</option>
            {TRAVEL_DOCUMENT_TYPES.map((v) => <option key={v} value={v}>{t(`homeAffairs.naturalizationForm.travelDocumentType.${v}`)}</option>)}
          </select>
        </FormField>
        <FormField label={t('homeAffairs.naturalizationForm.field.travelDocumentNumber')} htmlFor={`${idPrefix}travelDocumentNumber`} required>
          <input id={`${idPrefix}travelDocumentNumber`} required className="form-input" value={form.travelDocumentNumber} onChange={(e) => onChange('travelDocumentNumber', e.target.value)} />
        </FormField>
      </div>
      <FormField label={t('homeAffairs.naturalizationForm.field.immigrationStatus')} htmlFor={`${idPrefix}immigrationStatus`} required>
        <select id={`${idPrefix}immigrationStatus`} required className="form-input" value={form.immigrationStatus} onChange={(e) => onChange('immigrationStatus', e.target.value)}>
          <option value="">—</option>
          {IMMIGRATION_STATUSES.map((v) => <option key={v} value={v}>{t(`homeAffairs.naturalizationForm.immigrationStatus.${v}`)}</option>)}
        </select>
      </FormField>
      <FormField label={t('homeAffairs.naturalizationForm.field.arrivalDate')} htmlFor={`${idPrefix}arrivalDate`} required help={t('homeAffairs.naturalizationForm.field.arrivalDateHelp')}>
        <input id={`${idPrefix}arrivalDate`} type="date" required className="form-input" value={form.arrivalDate} onChange={(e) => onChange('arrivalDate', e.target.value)} />
      </FormField>
    </>
  );
}

function ApplicantView({ t }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [photoReference, setPhotoReference] = useState(null);
  const [chiefLetterReference, setChiefLetterReference] = useState(null);
  const [receipt, setReceipt] = useState({ paymentReference: '', receiptImageReference: '' });
  // Hand-biometric capture — required (see naturalization.controller.js's submit/approve). This
  // applicant has no citizen_id yet, so BiometricCapture is used with enroll={false}: the real
  // hand-geometry template it extracts is carried in the form's own submission instead of being
  // self-enrolled immediately, and the officer's approval is what actually enrols it (the
  // moment a citizen_id is minted) — see approveNaturalization.
  const [leftHandBiometricReference, setLeftHandBiometricReference] = useState(null);
  const [rightHandBiometricReference, setRightHandBiometricReference] = useState(null);
  const [leftHandTemplate, setLeftHandTemplate] = useState(null);
  const [rightHandTemplate, setRightHandTemplate] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [resubmitTarget, setResubmitTarget] = useState(null);

  function load() { api.get('/home-affairs/naturalization').then((d) => setRows(d.naturalizationRequests)).catch(() => setRows([])); }
  useEffect(() => { load(); }, []);
  useSyncCitizenAccessAfterApproval(rows);

  function update(name, value) { setForm((f) => ({ ...f, [name]: value })); }

  function resetForm() {
    setForm(emptyForm());
    setPhotoReference(null);
    setChiefLetterReference(null);
    setReceipt({ paymentReference: '', receiptImageReference: '' });
    setLeftHandBiometricReference(null);
    setRightHandBiometricReference(null);
    setLeftHandTemplate(null);
    setRightHandTemplate(null);
    setResubmitTarget(null);
  }

  function startResubmit(row) {
    setResubmitTarget(row.naturalization_request_id);
    setForm({
      firstName: row.first_name || '', middleName: row.middle_name || '', lastName: row.last_name || '',
      dateOfBirth: row.date_of_birth ? row.date_of_birth.slice(0, 10) : '', placeOfBirth: row.place_of_birth || '',
      sex: row.sex || '', nationality: row.nationality || '', travelDocumentType: row.travel_document_type || '',
      travelDocumentNumber: row.travel_document_number || '', immigrationStatus: row.immigration_status || '',
      arrivalDate: row.arrival_date ? row.arrival_date.slice(0, 10) : '',
    });
    setPhotoReference(row.photo_reference || null);
    setChiefLetterReference(row.chief_letter_reference || null);
    setReceipt({ paymentReference: row.payment_reference || '', receiptImageReference: row.receipt_image_reference || '' });
    // Hand templates aren't re-shown here (they're numbers, not an image) — keeping them null
    // means a resubmission without a fresh scan falls back to what was already on file (see
    // resubmitNaturalization's `|| record.left_hand_template` fallback) rather than requiring a
    // re-scan every time unless the officer specifically asked for one.
    setLeftHandBiometricReference(row.left_hand_biometric_reference || null);
    setRightHandBiometricReference(row.right_hand_biometric_reference || null);
    setLeftHandTemplate(null);
    setRightHandTemplate(null);
    setError(''); setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!photoReference) { setError(t('photoCapture.required')); return; }
    if (!chiefLetterReference) { setError(t('homeAffairs.naturalizationForm.field.chiefLetterRequired')); return; }
    if (!receipt.paymentReference.trim() || !receipt.receiptImageReference) { setError(t('receiptCapture.required')); return; }
    if (!leftHandBiometricReference || !rightHandBiometricReference) { setError(t('biometricCapture.required')); return; }
    setBusy(true);
    try {
      const payload = {
        ...form, photoReference, chiefLetterReference,
        paymentReference: receipt.paymentReference.trim(), receiptImageReference: receipt.receiptImageReference,
        leftHandBiometricReference, rightHandBiometricReference, leftHandTemplate, rightHandTemplate,
      };
      if (resubmitTarget) {
        await api.post(`/home-affairs/naturalization/${resubmitTarget}/resubmit`, payload);
        setSuccess(t('services.resubmitted'));
      } else {
        const result = await api.post('/home-affairs/naturalization', payload);
        setSuccess(t('services.submittedWithReference', { reference: result.naturalizationRequest?.request_reference }));
      }
      resetForm();
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <Loading />;

  const hasActiveApplication = rows.some((r) => !['Rejected'].includes(r.status));

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.naturalizationForm.title')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('homeAffairs.naturalizationForm.intro')}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      {(!hasActiveApplication || resubmitTarget) && (
        <form onSubmit={onSubmit} className="card mb-8" noValidate>
          {resubmitTarget && (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
              <span>✎ {t('common.editAndResubmit')}</span>
              <button type="button" className="font-semibold underline" onClick={resetForm}>{t('common.cancel')}</button>
            </div>
          )}
          <p className="mb-3 text-sm text-slate-600">ℹ {t('homeAffairs.naturalizationForm.eligibilityNotice')}</p>
          <FieldGrid t={t} form={form} onChange={update} />
          <PhotoCapture value={photoReference} onChange={setPhotoReference} label={t('homeAffairs.naturalizationForm.field.photo')} help={t('photoCapture.idHelp')} faceCheck />
          <PhotoCapture value={chiefLetterReference} onChange={setChiefLetterReference} label={t('homeAffairs.naturalizationForm.field.chiefLetter')} help={t('homeAffairs.naturalizationForm.field.chiefLetterHelp')} />
          <ReceiptCapture value={receipt} onChange={setReceipt} help={t('homeAffairs.naturalizationForm.feeNotice')} />
          <p className="mb-2 text-sm font-medium text-slate-700">{t('homeAffairs.naturalizationForm.field.handBiometrics')}</p>
          <BiometricCapture
            value={leftHandBiometricReference}
            onChange={(ref, template) => { setLeftHandBiometricReference(ref); setLeftHandTemplate(template); }}
            label={t('biometricCapture.leftHandLabel')}
            help={t('biometricCapture.scanHint')}
            hand="left"
            enroll={false}
          />
          <BiometricCapture
            value={rightHandBiometricReference}
            onChange={(ref, template) => { setRightHandBiometricReference(ref); setRightHandTemplate(template); }}
            label={t('biometricCapture.rightHandLabel')}
            help={t('biometricCapture.scanHint')}
            hand="right"
            enroll={false}
          />
          <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : (resubmitTarget ? t('common.resubmitForReview') : t('homeAffairs.naturalizationForm.submit'))}</button>
        </form>
      )}

      <h2 className="mb-3 text-lg font-semibold text-slate-900">{t('services.myRequests')}</h2>
      <DataTable
        rowKey="naturalization_request_id"
        rows={rows}
        emptyTitle={t('common.noResults')}
        columns={[
          { key: 'reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.request_reference}</span> },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          { key: 'requested_at', header: t('services.submittedAt'), render: (r) => formatDateOnly(r.requested_at) },
          {
            key: 'result', header: t('common.actions'),
            render: (r) => {
              if (['Additional Information Required', 'Rejected'].includes(r.status)) {
                return <button type="button" className="text-xs font-semibold text-gov-navy underline" onClick={() => startResubmit(r)}>{t('common.editAndResubmit')}</button>;
              }
              if (r.status === 'Approved') {
                return (
                  <div className="text-xs text-slate-600">
                    <div>{t('homeAffairs.naturalizationQueue.certificateLabel')}: <span className="font-mono">{r.certificate_number}</span></div>
                    {r.resulting_permanent_identity_number && (
                      <div>{t('homeAffairs.naturalizationQueue.newIdNumberLabel')}: <span className="font-mono">{r.resulting_permanent_identity_number}</span></div>
                    )}
                  </div>
                );
              }
              return r.rejection_reason ? <span className="text-xs text-gov-red">{r.rejection_reason}</span> : null;
            },
          },
        ]}
      />
    </div>
  );
}

function OfficerQueue({ t }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(null);
  const [reasonTarget, setReasonTarget] = useState(null); // { id, action }
  const [reason, setReason] = useState('');
  const [detailRow, setDetailRow] = useState(null);

  function load() { api.get('/home-affairs/naturalization').then((d) => setRows(d.naturalizationRequests)).catch(() => setRows([])); }
  useEffect(() => { load(); }, []);

  async function act(id, action, body) {
    setError(''); setSuccess(''); setBusy(id);
    try {
      await api.post(`/home-affairs/naturalization/${id}/${action}`, body);
      setSuccess(t('services.actionRecorded'));
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(null);
    }
  }

  async function onReasonSubmit(e) {
    e.preventDefault();
    if (!reasonTarget) return;
    await act(reasonTarget.id, reasonTarget.action, { reason });
    setReasonTarget(null); setReason('');
  }

  if (!rows) return <Loading />;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.naturalizationQueue.title')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('homeAffairs.naturalizationQueue.desc')}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      <DataTable
        rowKey="naturalization_request_id"
        rows={rows}
        emptyTitle={t('homeAffairs.naturalizationQueue.empty')}
        columns={[
          { key: 'reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.request_reference}</span> },
          { key: 'applicant', header: t('homeAffairs.naturalizationQueue.applicant'), render: (r) => `${r.first_name} ${r.last_name}` },
          { key: 'nationality', header: t('homeAffairs.naturalizationForm.field.nationality'), render: (r) => r.nationality },
          { key: 'arrival', header: t('homeAffairs.naturalizationForm.field.arrivalDate'), render: (r) => formatDateOnly(r.arrival_date) },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          {
            key: 'actions', header: t('common.actions'),
            render: (r) => (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="text-xs font-semibold text-slate-600 underline" onClick={() => setDetailRow(r)}>{t('common.viewDetails')}</button>
                {r.status === 'Submitted' && (
                  <button type="button" disabled={busy === r.naturalization_request_id} className="text-xs font-semibold text-gov-navy underline"
                    onClick={() => act(r.naturalization_request_id, 'start-review')}>{t('services.startReview')}</button>
                )}
                {r.status === 'Under Review' && (
                  <>
                    <button type="button" disabled={busy === r.naturalization_request_id} className="text-xs font-semibold text-gov-amber underline"
                      onClick={() => setReasonTarget({ id: r.naturalization_request_id, action: 'request-information' })}>{t('services.requestInfo')}</button>
                    <button type="button" disabled={busy === r.naturalization_request_id} className="text-xs font-semibold text-gov-green underline"
                      onClick={() => act(r.naturalization_request_id, 'approve')}>{t('common.approve')}</button>
                    <button type="button" disabled={busy === r.naturalization_request_id} className="text-xs font-semibold text-gov-red underline"
                      onClick={() => setReasonTarget({ id: r.naturalization_request_id, action: 'reject' })}>{t('common.reject')}</button>
                  </>
                )}
                {!['Submitted', 'Under Review'].includes(r.status) && r.status !== 'Approved' && r.status !== 'Rejected' && (
                  <button type="button" disabled={busy === r.naturalization_request_id} className="text-xs font-semibold text-gov-red underline"
                    onClick={() => setReasonTarget({ id: r.naturalization_request_id, action: 'reject' })}>{t('common.reject')}</button>
                )}
                {r.status === 'Approved' && (
                  <div className="text-xs text-slate-600">
                    <div>{t('homeAffairs.naturalizationQueue.certificateLabel')}: <span className="font-mono">{r.certificate_number}</span></div>
                    {r.resulting_permanent_identity_number && <div className="font-mono">{r.resulting_permanent_identity_number}</div>}
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={!!reasonTarget}
        onClose={() => setReasonTarget(null)}
        title={reasonTarget?.action === 'reject' ? t('common.reject') : t('services.requestInfo')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReasonTarget(null)}>{t('common.cancel')}</button>
            <button type="submit" form="naturalization-reason-form" className="btn-primary">{t('common.submit')}</button>
          </>
        }
      >
        <form id="naturalization-reason-form" onSubmit={onReasonSubmit} noValidate>
          <FormField label={t('services.reason')} htmlFor="naturalizationReason" required>
            <textarea id="naturalizationReason" required rows={3} className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </form>
      </Modal>

      <Modal
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        title={t('common.viewDetails')}
        footer={<button type="button" className="btn-secondary" onClick={() => setDetailRow(null)}>{t('common.close')}</button>}
      >
        {detailRow && (
          <dl className="space-y-3">
            {[
              [t('homeAffairs.naturalizationForm.field.firstName'), `${detailRow.first_name} ${detailRow.middle_name || ''} ${detailRow.last_name}`.replace(/\s+/g, ' ').trim()],
              [t('homeAffairs.naturalizationForm.field.dateOfBirth'), formatDateOnly(detailRow.date_of_birth)],
              [t('homeAffairs.naturalizationForm.field.placeOfBirth'), detailRow.place_of_birth || t('services.notProvided')],
              [t('homeAffairs.naturalizationForm.field.sex'), t(`homeAffairs.naturalizationForm.${(detailRow.sex || '').toLowerCase()}`)],
              [t('homeAffairs.naturalizationForm.field.nationality'), detailRow.nationality],
              [t('homeAffairs.naturalizationForm.field.travelDocumentType'), t(`homeAffairs.naturalizationForm.travelDocumentType.${detailRow.travel_document_type}`)],
              [t('homeAffairs.naturalizationForm.field.travelDocumentNumber'), detailRow.travel_document_number],
              [t('homeAffairs.naturalizationForm.field.immigrationStatus'), t(`homeAffairs.naturalizationForm.immigrationStatus.${detailRow.immigration_status}`)],
              [t('homeAffairs.naturalizationForm.field.arrivalDate'), formatDateOnly(detailRow.arrival_date)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
                <dd className="text-sm text-slate-800">{value}</dd>
              </div>
            ))}
            <div>
              <dt className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.naturalizationForm.field.photo')}</dt>
              <dd>
                {detailRow.photo_reference ? (
                  <a href={`/uploads/${detailRow.photo_reference}`} target="_blank" rel="noreferrer">
                    <img src={`/uploads/${detailRow.photo_reference}`} alt={t('photoCapture.previewAlt')} className="h-28 w-24 rounded border border-slate-200 object-cover" />
                  </a>
                ) : t('services.notProvided')}
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.naturalizationForm.field.chiefLetter')}</dt>
              <dd>
                {detailRow.chief_letter_reference ? (
                  <a href={`/uploads/${detailRow.chief_letter_reference}`} target="_blank" rel="noreferrer">
                    <img src={`/uploads/${detailRow.chief_letter_reference}`} alt={t('homeAffairs.naturalizationForm.field.chiefLetter')} className="h-28 w-24 rounded border border-slate-200 object-cover" />
                  </a>
                ) : t('services.notProvided')}
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('receiptCapture.label')}</dt>
              <dd>
                {detailRow.receipt_image_reference ? (
                  <a href={`/uploads/${detailRow.receipt_image_reference}`} target="_blank" rel="noreferrer" className="block">
                    <img src={`/uploads/${detailRow.receipt_image_reference}`} alt={t('receiptCapture.previewAlt')} className="h-28 w-24 rounded border border-slate-200 object-cover" />
                    <span className="block font-mono text-[10px] text-slate-400">{detailRow.payment_reference}</span>
                  </a>
                ) : t('services.notProvided')}
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.naturalizationForm.field.handBiometrics')}</dt>
              <dd className="flex gap-4 text-sm">
                {detailRow.left_hand_biometric_reference ? (
                  <a href={`/uploads/${detailRow.left_hand_biometric_reference}`} target="_blank" rel="noreferrer" className="text-gov-green underline">✓ {t('biometricCapture.leftHandLabel')}</a>
                ) : <span className="text-gov-red">✕ {t('biometricCapture.leftHandLabel')}</span>}
                {detailRow.right_hand_biometric_reference ? (
                  <a href={`/uploads/${detailRow.right_hand_biometric_reference}`} target="_blank" rel="noreferrer" className="text-gov-green underline">✓ {t('biometricCapture.rightHandLabel')}</a>
                ) : <span className="text-gov-red">✕ {t('biometricCapture.rightHandLabel')}</span>}
              </dd>
            </div>
            {detailRow.rejection_reason && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('services.reason')}</dt>
                <dd className="text-sm text-gov-red">{detailRow.rejection_reason}</dd>
              </div>
            )}
          </dl>
        )}
      </Modal>
    </div>
  );
}
