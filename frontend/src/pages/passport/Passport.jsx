import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import Modal from '../../components/ui/Modal';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';
import PhotoCapture from '../../components/PhotoCapture';
import ReceiptCapture from '../../components/ReceiptCapture';
import SignaturePad from '../../components/SignaturePad';

const NEXT = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
  'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
  'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
  'Processing': { action: 'approve', labelKey: 'common.approve' },
  'Approved': { action: 'produce', labelKey: 'status.Passport Produced' },
  'Passport Produced': { action: 'ready-for-collection', labelKey: 'common.readyForCollection' },
  'Ready for Collection': { action: 'collect', labelKey: 'common.collect' },
};

export default function Passport() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['passport_officer', 'system_administrator'].includes(user.roleKey);
  const [records, setRecords] = useState(null);
  const [passportType, setPassportType] = useState('Ordinary');
  const [preferredOfficeId, setPreferredOfficeId] = useState('');
  const [photoReference, setPhotoReference] = useState(null);
  const [receipt, setReceipt] = useState({ paymentReference: '', receiptImageReference: '' });
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState('');
  const [signatureModal, setSignatureModal] = useState(null); // passport_record_id | null
  const [signatureReference, setSignatureReference] = useState(null);
  // Feature 4 — editing a rejected/information-required application instead of starting a new
  // one. When set, the form above switches to editing that record and submits to /resubmit.
  const [resubmitTarget, setResubmitTarget] = useState(null);

  function load() { api.get('/passport').then((d) => setRecords(d.passportRecords)); }
  useEffect(() => { load(); }, []);

  function startResubmit(record) {
    setResubmitTarget(record);
    setPassportType(record.passport_type || 'Ordinary');
    setPreferredOfficeId(record.preferred_office_id || record.collection_office_id || '');
    setPhotoReference(record.photo_reference || null);
    setReceipt({ paymentReference: record.payment_reference || '', receiptImageReference: record.receipt_image_reference || '' });
    setError('');
  }

  function cancelResubmit() {
    setResubmitTarget(null);
    setPassportType('Ordinary');
    setPreferredOfficeId('');
    setPhotoReference(null);
    setReceipt({ paymentReference: '', receiptImageReference: '' });
    setError('');
  }

  async function apply(e) {
    e.preventDefault();
    setError('');
    if (!preferredOfficeId) { setError(t('offices.chooseBranchRequired')); return; }
    if (!photoReference) { setError(t('photoCapture.required')); return; }
    if (!receipt.paymentReference.trim() || !receipt.receiptImageReference) { setError(t('receiptCapture.required')); return; }
    try {
      const payload = {
        passportType, preferredOfficeId, photoReference,
        paymentReference: receipt.paymentReference.trim(), receiptImageReference: receipt.receiptImageReference,
      };
      if (resubmitTarget) {
        await api.post(`/passport/${resubmitTarget.passport_record_id}/resubmit`, payload);
      } else {
        await api.post('/passport/apply', payload);
      }
      cancelResubmit();
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    }
  }

  async function transition(id, action) {
    await api.post(`/passport/${id}/${action}`, {});
    load();
  }

  // Collection (Feature 3): collecting the passport requires the citizen's signature, captured
  // on a pad handed to them at the counter — see SignaturePad.jsx.
  async function confirmCollect() {
    await api.post(`/passport/${signatureModal}/collect`, { signatureReference });
    setSignatureModal(null);
    setSignatureReference(null);
    load();
  }

  async function submitModal() {
    await api.post(`/passport/${modal.id}/${modal.kind}`, { reason });
    setModal(null); setReason('');
    load();
  }

  if (!records) return <Loading />;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('passport.title')}</h1>

      {!isOfficer && (
        <form onSubmit={apply} className="card mb-8">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
          {resubmitTarget ? (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
              <span>
                ✎ {t('common.editAndResubmit')} — <span className="font-mono text-xs">{resubmitTarget.application_reference}</span>
                {resubmitTarget.rejection_reason ? `: ${resubmitTarget.rejection_reason}` : ''}
              </span>
              <button type="button" className="font-semibold underline" onClick={cancelResubmit}>{t('common.cancel')}</button>
            </div>
          ) : (
            <p className="mb-3 text-sm text-slate-600">ℹ {t('passport.reuseNotice')}</p>
          )}
          <div className="mb-4 max-w-xs">
            <label htmlFor="passportType" className="form-label">{t('passport.type')}</label>
            <select id="passportType" className="form-input" value={passportType} onChange={(e) => setPassportType(e.target.value)}>
              <option value="Ordinary">{t('passport.ordinary')}</option>
              <option value="Diplomatic">{t('passport.diplomatic')}</option>
              <option value="Official">{t('passport.official')}</option>
            </select>
          </div>
          <PhotoCapture value={photoReference} onChange={setPhotoReference} help={t('photoCapture.idHelp')} faceCheck />
          <ReceiptCapture value={receipt} onChange={setReceipt} help={t('passport.feeNotice')} />
          <DistrictOfficeSelect departmentKey="passport" value={preferredOfficeId} onChange={setPreferredOfficeId} />
          <button type="submit" className="btn-primary">{resubmitTarget ? t('common.resubmitForReview') : t('passport.apply')}</button>
        </form>
      )}

      <DataTable
        rowKey="passport_record_id"
        rows={records}
        columns={[
          {
            key: 'photo', header: t('photoCapture.label'),
            render: (r) => (r.photo_reference
              ? <img src={`/uploads/${r.photo_reference}`} alt={t('photoCapture.previewAlt')} className="h-10 w-8 rounded border border-slate-200 object-cover" />
              : <span className="text-slate-300">—</span>),
          },
          { key: 'application_reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.application_reference}</span> },
          ...(isOfficer ? [{ key: 'name', header: 'Citizen', render: (r) => `${r.first_name} ${r.last_name}` }] : []),
          ...(isOfficer ? [{
            key: 'receipt', header: t('receiptCapture.label'),
            render: (r) => (r.receipt_image_reference
              ? (
                <a href={`/uploads/${r.receipt_image_reference}`} target="_blank" rel="noreferrer" className="block">
                  <img src={`/uploads/${r.receipt_image_reference}`} alt={t('receiptCapture.previewAlt')} className="h-10 w-8 rounded border border-slate-200 object-cover" />
                  <span className="block font-mono text-[10px] text-slate-400">{r.payment_reference}</span>
                </a>
              )
              : <span className="text-slate-300">—</span>),
          }] : []),
          { key: 'passport_type', header: t('passport.type'), render: (r) => t(`passport.${r.passport_type.toLowerCase()}`) },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          { key: 'passport_number', header: t('passport.passportNumber'), render: (r) => r.passport_number ? <span className="font-mono text-xs">{r.passport_number}</span> : '—' },
          ...(isOfficer ? [{
            key: 'actions', header: t('common.actions'),
            render: (r) => {
              const next = NEXT[r.status];
              return (
                <div className="flex flex-wrap gap-2">
                  {next && (
                    <button
                      type="button"
                      className="text-sm font-medium text-gov-navy hover:underline"
                      onClick={() => (next.action === 'collect' ? setSignatureModal(r.passport_record_id) : transition(r.passport_record_id, next.action))}
                    >
                      {t(next.labelKey)}
                    </button>
                  )}
                  {!['Rejected', 'Collected'].includes(r.status) && (
                    <>
                      <button type="button" className="text-sm font-medium text-slate-500 hover:underline" onClick={() => setModal({ id: r.passport_record_id, kind: 'request-information' })}>{t('common.requestInformation')}</button>
                      <button type="button" className="text-sm font-medium text-gov-red hover:underline" onClick={() => setModal({ id: r.passport_record_id, kind: 'reject' })}>{t('common.reject')}</button>
                    </>
                  )}
                </div>
              );
            },
          }] : [{
            key: 'actions', header: t('common.actions'),
            render: (r) => (['Additional Information Required', 'Rejected'].includes(r.status)
              ? (
                <button
                  type="button"
                  className="text-sm font-medium text-gov-navy hover:underline"
                  onClick={() => { startResubmit(r); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                >
                  {t('common.editAndResubmit')}
                </button>
              )
              : <span className="text-slate-300">—</span>),
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
        <label htmlFor="passportReason" className="form-label">{t('common.reason')}</label>
        <textarea id="passportReason" className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>

      <Modal
        open={!!signatureModal}
        onClose={() => { setSignatureModal(null); setSignatureReference(null); }}
        title={t('common.collect')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => { setSignatureModal(null); setSignatureReference(null); }}>{t('common.cancel')}</button>
            <button type="button" disabled={!signatureReference} className="btn-primary" onClick={confirmCollect}>{t('common.confirm')}</button>
          </>
        }
      >
        <SignaturePad value={signatureReference} onChange={setSignatureReference} />
      </Modal>
    </div>
  );
}
