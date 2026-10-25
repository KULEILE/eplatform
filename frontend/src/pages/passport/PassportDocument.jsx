import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import SignaturePad from '../../components/SignaturePad';
import { formatDateOnly } from '../../utils/format';

// Mirrors Passport.jsx's own NEXT map exactly (same actions, same endpoints) — duplicated rather
// than shared so this page stays a self-contained document view, same pattern as how
// NationalIdDetail.jsx keeps its own NEXT map independent of any list page.
//
// Batch 13: every pre-production status now collapses onto the single 'confirm' action, right
// below the full-size photo/receipt review this page already shows — the officer looks at the
// reference and proof above, and confirming jumps straight to 'Passport Produced'. The backend
// enforces a first-submitted-first-confirmed order on this action; a blocked attempt comes back
// as a normal API error, shown below the button.
const NEXT = {
  'Submitted': { action: 'confirm', labelKey: 'passport.confirmProof' },
  'Under Review': { action: 'confirm', labelKey: 'passport.confirmProof' },
  'Identity Verified': { action: 'confirm', labelKey: 'passport.confirmProof' },
  'Documents Checked': { action: 'confirm', labelKey: 'passport.confirmProof' },
  'Processing': { action: 'confirm', labelKey: 'passport.confirmProof' },
  'Approved': { action: 'confirm', labelKey: 'passport.confirmProof' },
  'Passport Produced': { action: 'ready-for-collection', labelKey: 'common.readyForCollection' },
  'Ready for Collection': { action: 'collect', labelKey: 'common.collect' },
};

/**
 * Passport bio-data page, laid out after the real Lesotho passport's bio-data page (type,
 * passport no., surname, given name(s), nationality, sex, date/place of birth, date of
 * issue/expiry, authority, national ID no., holder's signature, decorative MRZ strip).
 *
 * This is also where the "officer must be able to see photos and receipts so that they reject
 * bad images" requirement is met: Passport.jsx's list only ever showed a thumbnail. Here the
 * officer gets the full-size photo and full-size receipt image together with the same
 * reject / request-information / next-step / collect actions Passport.jsx already exposes (same
 * endpoints — this page does not introduce new backend behaviour), so a bad image can be caught
 * and rejected without guessing from a tiny thumbnail.
 */
export default function PassportDocument() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['passport_officer', 'system_administrator'].includes(user.roleKey);
  const [record, setRecord] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // 'reject' | 'request-information' | null
  const [reason, setReason] = useState('');
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureReference, setSignatureReference] = useState(null);

  function load() {
    setLoadError('');
    api.get(`/passport/${id}`)
      .then((d) => setRecord(d.passportRecord))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  async function runAction(action) {
    setBusy(true);
    setActionError('');
    try {
      await api.post(`/passport/${id}/${action}`, {});
      load();
    } catch (err) {
      // Batch 13: 'confirm' can legitimately be blocked (first-submitted-first-confirmed order)
      // — surface that explanation instead of failing silently.
      setActionError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function submitModal() {
    setBusy(true);
    try {
      await api.post(`/passport/${id}/${modal}`, { reason });
      setModal(null); setReason('');
      load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmCollect() {
    setBusy(true);
    try {
      await api.post(`/passport/${id}/collect`, { signatureReference });
      setSignatureModalOpen(false);
      setSignatureReference(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon="⚠"
          title={t('common.somethingWentWrong')}
          message={loadError}
          action={<Link to="/passport" className="btn-secondary">{t('common.back')}</Link>}
        />
      </div>
    );
  }
  if (!record) return <Loading />;

  const next = isOfficer ? NEXT[record.status] : null;
  const isIssued = !!record.passport_number && !!record.issue_date;
  const givenNames = `${record.first_name || ''} ${record.middle_name || ''}`.trim();
  const canAct = isOfficer && !['Rejected', 'Collected'].includes(record.status);

  // Decorative two-line MRZ-style strip, deliberately not a real machine-readable zone (no check
  // digits computed) — purely a visual flourish matching the photographed passport's look.
  const pad = (s, len) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(len, '<').slice(0, len);
  const mrzLine1 = `P<LSO${pad(record.last_name, 10)}<<${pad(givenNames, 29)}`.slice(0, 44);
  const mrzLine2 = `${pad(record.passport_number || '', 9)}${pad('LSO', 3)}${pad(record.permanent_identity_number, 20)}`.slice(0, 44);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t('passport.document.title')}</h1>
        <Link to="/passport" className="text-sm font-medium text-gov-navy hover:underline">← {t('common.back')}</Link>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-gov-amber">
        <span>⚠ {t('passport.document.demoNotice')}</span>
        <StatusBadge status={record.status} />
      </div>

      {/* The bio-data page itself */}
      <div className="relative overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="rotate-[-20deg] select-none whitespace-nowrap text-4xl font-black uppercase tracking-widest text-slate-100">DEMO</span>
        </div>
        <div className="flex items-center gap-2 bg-gov-navy px-4 py-2 text-white">
          <img
            src="/images/lesotho-flag.png"
            alt={t('homeAffairs.birthCertificateView.emblemAlt')}
            className="h-5 w-8 shrink-0 rounded-sm object-cover"
          />
          <div className="leading-tight">
            <p className="text-[10px] uppercase tracking-widest text-slate-200">{t('homeAffairs.birthCertificateView.kingdomOfLesotho')}</p>
            <p className="text-xs font-bold uppercase tracking-wide">{t('passport.document.cardTitle')}</p>
          </div>
        </div>

        <div className="relative flex gap-4 p-4">
          <div className="flex shrink-0 flex-col items-center gap-2">
            {record.photo_reference ? (
              <img
                src={`/uploads/${record.photo_reference}`}
                alt={t('photoCapture.previewAlt')}
                className="h-28 w-24 rounded border border-slate-300 object-cover"
              />
            ) : (
              <div className="flex h-28 w-24 items-center justify-center rounded border border-slate-300 bg-slate-50 text-3xl text-slate-300">👤</div>
            )}
            <p className="text-center text-[9px] uppercase leading-tight text-slate-400">
              {record.photo_reference ? t('passport.document.photoCaptured') : t('passport.document.photoPlaceholder')}
            </p>
          </div>

          <dl className="grid flex-1 grid-cols-1 gap-x-3 gap-y-1.5 text-sm">
            <div><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.type')}: </dt><dd className="inline font-bold text-slate-900">P</dd></div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.passportNo')}: </dt><dd className="inline font-mono font-bold text-slate-900">{record.passport_number || '—'}</dd></div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.surname')}: </dt><dd className="inline font-bold text-slate-900">{record.last_name}</dd></div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.givenNames')}: </dt><dd className="inline font-medium text-slate-900">{givenNames}</dd></div>
            <div className="flex gap-4">
              <span><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.nationality')}: </dt><dd className="inline font-medium text-slate-900">{t('passport.document.nationalityValue')}</dd></span>
              <span><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.sex')}: </dt><dd className="inline font-medium text-slate-900">{record.sex}</dd></span>
            </div>
            <div className="flex gap-4">
              <span><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.dateOfBirth')}: </dt><dd className="inline font-medium text-slate-900">{formatDateOnly(record.date_of_birth)}</dd></span>
              <span><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.placeOfBirth')}: </dt><dd className="inline font-medium text-slate-900">{record.place_of_birth || t('homeAffairs.birthCertificateView.notRecorded')}</dd></span>
            </div>
            <div className="flex gap-4">
              <span><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.dateOfIssue')}: </dt><dd className="inline font-medium text-slate-900">{isIssued ? formatDateOnly(record.issue_date) : '—'}</dd></span>
              <span><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.dateOfExpiry')}: </dt><dd className="inline font-medium text-slate-900">{isIssued ? formatDateOnly(record.expiry_date) : '—'}</dd></span>
            </div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('passport.document.field.authority')}: </dt><dd className="inline font-medium text-slate-900">LSO</dd></div>
          </dl>
        </div>

        <div className="relative flex items-center justify-between border-t border-dashed border-slate-300 px-4 py-2">
          <p className="font-mono text-xs tracking-widest text-slate-500">{t('passport.document.field.nationalIdNo')}: {record.permanent_identity_number}</p>
          {record.signature_reference ? (
            <img src={`/uploads/${record.signature_reference}`} alt={t('signaturePad.label')} className="h-8 w-20 border-b border-slate-400 object-contain" />
          ) : (
            <div className="h-6 w-20 border-b border-slate-400 text-center text-[8px] uppercase text-slate-400">{t('passport.document.signaturePlaceholder')}</div>
          )}
        </div>

        {/* Decorative MRZ strip — explicitly not a functional machine-readable zone. */}
        <div className="relative border-t border-slate-200 bg-slate-50 px-4 py-2">
          <p className="font-mono text-[11px] leading-tight tracking-wider text-slate-500">{mrzLine1}</p>
          <p className="font-mono text-[11px] leading-tight tracking-wider text-slate-500">{mrzLine2}</p>
          <p className="mt-1 text-[9px] uppercase text-slate-400">{t('passport.document.mrzDisclaimer')}</p>
        </div>
      </div>

      <div className="card mt-4">
        <p className="mb-4 text-sm text-slate-600">{t(`statusHelp.${record.status}`)}</p>
        {record.rejection_reason && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red">⚠ {record.rejection_reason}</p>
        )}

        {/* Batch 14: a Pages Full renewal can't be produced until the citizen brings the original
            passport in and an officer checks it — visible to the citizen too, so they know to
            bring it, not just to the officer deciding whether it's been done. */}
        {record.surrender_status === 'Awaiting Surrender' && (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">⚠ {t('passport.surrender.awaitingNotice')}</p>
        )}
        {record.surrender_status === 'Surrendered' && (
          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {t('passport.surrender.verifiedNotice')}</p>
        )}

        {/* Full-size photo + receipt review — this is the part that lets an officer actually
            catch a bad image instead of guessing from the thumbnail on the list page. */}
        {isOfficer && (
          <div className="mb-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('photoCapture.label')}</p>
              {record.photo_reference ? (
                <a href={`/uploads/${record.photo_reference}`} target="_blank" rel="noreferrer">
                  <img src={`/uploads/${record.photo_reference}`} alt={t('photoCapture.previewAlt')} className="h-48 w-full rounded border border-slate-200 object-contain bg-slate-50" />
                  <span className="mt-1 block text-xs text-gov-navy underline">{t('passport.document.openFullSize')}</span>
                </a>
              ) : <p className="text-sm text-slate-400">—</p>}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('receiptCapture.label')}</p>
              {record.receipt_image_reference ? (
                <a href={`/uploads/${record.receipt_image_reference}`} target="_blank" rel="noreferrer">
                  <img src={`/uploads/${record.receipt_image_reference}`} alt={t('receiptCapture.previewAlt')} className="h-48 w-full rounded border border-slate-200 object-contain bg-slate-50" />
                  <span className="mt-1 block text-xs text-gov-navy underline">{t('passport.document.openFullSize')}</span>
                  <span className="mt-1 block font-mono text-xs text-slate-500">{record.payment_reference}</span>
                </a>
              ) : <p className="text-sm text-slate-400">—</p>}
            </div>
            {record.pages_full_proof_reference && (
              <div className="sm:col-span-2">
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('passport.renewal.field.lastPageProof')}</p>
                <a href={`/uploads/${record.pages_full_proof_reference}`} target="_blank" rel="noreferrer">
                  <img src={`/uploads/${record.pages_full_proof_reference}`} alt={t('passport.renewal.field.lastPageProof')} className="h-48 w-full rounded border border-slate-200 object-contain bg-slate-50" />
                  <span className="mt-1 block text-xs text-gov-navy underline">{t('passport.document.openFullSize')}</span>
                </a>
                <p className="mt-1 text-xs text-slate-500">
                  {t('passport.renewal.field.pageCount')}: {record.pages_full_page_count} · {t('passport.renewal.field.confirmPassportNumber')}: <span className="font-mono">{record.entered_passport_number || '—'}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {canAct && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            {actionError && <p className="w-full rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {actionError}</p>}
            {next && (
              <button
                type="button"
                disabled={busy}
                className="btn-primary"
                onClick={() => (next.action === 'collect' ? setSignatureModalOpen(true) : runAction(next.action))}
              >
                {record.surrender_status === 'Awaiting Surrender' && next.action === 'confirm' ? t('passport.surrender.confirmBoth') : t(next.labelKey)}
              </button>
            )}
            {record.surrender_status === 'Awaiting Surrender' && (
              <button type="button" disabled={busy} className="text-sm font-medium text-gov-red hover:underline" onClick={() => setModal('surrender-failed')}>
                {t('passport.surrender.failed')}
              </button>
            )}
            <button type="button" disabled={busy} className="text-sm font-medium text-slate-500 hover:underline" onClick={() => setModal('request-information')}>{t('common.requestInformation')}</button>
            <button type="button" disabled={busy} className="text-sm font-medium text-gov-red hover:underline" onClick={() => setModal('reject')}>{t('common.reject')}</button>
          </div>
        )}
      </div>

      <Modal
        open={!!modal}
        onClose={() => { setModal(null); setReason(''); }}
        title={modal === 'reject' ? t('common.reject') : modal === 'surrender-failed' ? t('passport.surrender.failedModalTitle') : t('common.requestInformation')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => { setModal(null); setReason(''); }}>{t('common.cancel')}</button>
            <button
              type="button"
              disabled={busy || (modal !== 'surrender-failed' && !reason.trim())}
              className={modal === 'reject' || modal === 'surrender-failed' ? 'btn-danger' : 'btn-primary'}
              onClick={submitModal}
            >
              {t('common.confirm')}
            </button>
          </>
        }
      >
        {modal === 'surrender-failed' && <p className="mb-3 text-sm text-slate-600">{t('passport.surrender.failedModalHelp')}</p>}
        <label htmlFor="passportDocReason" className="form-label">{t('common.reason')}{modal === 'surrender-failed' && ` (${t('common.optional')})`}</label>
        <textarea id="passportDocReason" className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>

      <Modal
        open={signatureModalOpen}
        onClose={() => { setSignatureModalOpen(false); setSignatureReference(null); }}
        title={t('common.collect')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => { setSignatureModalOpen(false); setSignatureReference(null); }}>{t('common.cancel')}</button>
            <button type="button" disabled={busy || !signatureReference} className="btn-primary" onClick={confirmCollect}>{t('common.confirm')}</button>
          </>
        }
      >
        <SignaturePad value={signatureReference} onChange={setSignatureReference} />
      </Modal>
    </div>
  );
}
