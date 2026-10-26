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

// Mirrors DrivingLicence.jsx's own NEXT map exactly (same actions, same endpoints) — duplicated
// rather than shared so this page stays a self-contained document view, same pattern
// PassportDocument.jsx / NationalIdDetail.jsx already use for their own list pages.
const NEXT = {
  'Submitted': { action: 'confirm-payment', labelKey: 'traffic.drivingLicence.confirmPayment' },
  'Ready for Collection': { action: 'collect', labelKey: 'common.collect' },
};

/**
 * Batch 27 — "the system must generate the card like this one and then display it like id
 * display when citizen is entered on that license department" (a photo of a real Kingdom of
 * Lesotho Driving Licence was attached). This page is that card: laid out after the real card's
 * own field set and order (SADC/LS badges, name, I.D. No., Birth Date, Licence No., Validity
 * Period, Issuing Centre, Code, Vehicle Restriction, First Issue, signature line) rather than a
 * plain key-value list — same approach NationalIdDetail.jsx and PassportDocument.jsx already
 * take for their own cards/bio-data pages.
 *
 * "Code" is the vehicle category chosen at apply time (migration 072, Batch 26) — A/B/C/D, not
 * the numeric code the real sample card happened to show, per the citizen's own four-category
 * wording. "Vehicle Restriction" isn't a concept this system tracks anywhere, so it's always
 * shown as "None" — a demo placeholder, same spirit as the DEMO watermark already stamped across
 * the card. "First Issue" is NOT this record's own issue date: a real licence keeps that date
 * fixed across every later renewal/replacement, so it's resolved server-side (getOne, Batch 27)
 * as the earliest issue date among this citizen's own Collected driving licence records.
 *
 * The citizen's signature (captured at 'collect' — see the SignaturePad modal below and migration
 * 073) fills the "Signature" line once collected, the same signature-at-collection convention
 * migration 035 already established for National ID/passport/birth certificate/police clearance.
 * The "Traffic Commissioner" line on the real card is printed as a label only — this demo system
 * has no real traffic commissioner to sign it, so no signature graphic is fabricated there.
 */
export default function DrivingLicenceDocument() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['traffic_officer', 'system_administrator'].includes(user.roleKey);
  const [record, setRecord] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // 'reject' | 'request-information' | 'surrender-failed' | null
  const [reason, setReason] = useState('');
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureReference, setSignatureReference] = useState(null);

  function load() {
    setLoadError('');
    api.get(`/traffic/driving-licence/${id}`)
      .then((d) => setRecord(d.record))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  async function runAction(action) {
    setBusy(true);
    setActionError('');
    try {
      await api.post(`/traffic/driving-licence/${id}/${action}`, {});
      load();
    } catch (err) {
      setActionError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function submitModal() {
    setBusy(true);
    try {
      await api.post(`/traffic/driving-licence/${id}/${modal}`, { reason });
      setModal(null); setReason('');
      load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmCollect() {
    setBusy(true);
    try {
      await api.post(`/traffic/driving-licence/${id}/collect`, { signatureReference });
      setSignatureModalOpen(false);
      setSignatureReference(null);
      load();
    } catch (err) {
      setActionError(err.message || t('common.somethingWentWrong'));
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
          action={<Link to="/traffic/driving-licence" className="btn-secondary">{t('common.back')}</Link>}
        />
      </div>
    );
  }
  if (!record) return <Loading />;

  const next = isOfficer ? NEXT[record.status] : null;
  const isIssued = !!record.licence_number && !!record.issue_date;
  const canAct = isOfficer && !['Rejected', 'Collected'].includes(record.status);
  const awaitingSurrender = record.surrender_status === 'Awaiting Surrender';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t('traffic.drivingLicence.document.title')}</h1>
        <Link to="/traffic/driving-licence" className="text-sm font-medium text-gov-navy hover:underline">← {t('common.back')}</Link>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-gov-amber">
        <span>⚠ {t('traffic.drivingLicence.document.demoNotice')}</span>
        <StatusBadge status={record.status} />
      </div>

      {/* The card itself */}
      <div className="relative overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="rotate-[-20deg] select-none whitespace-nowrap text-4xl font-black uppercase tracking-widest text-slate-100">DEMO</span>
        </div>

        <div className="flex items-center justify-between gap-2 bg-gov-navy px-4 py-2 text-white">
          <div className="flex items-center gap-2">
            <img
              src="/images/lesotho-flag.png"
              alt={t('homeAffairs.birthCertificateView.emblemAlt')}
              className="h-5 w-8 shrink-0 rounded-sm object-cover"
            />
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-widest text-slate-200">{t('homeAffairs.birthCertificateView.kingdomOfLesotho')}</p>
              <p className="text-xs font-bold uppercase tracking-wide">{t('traffic.drivingLicence.document.cardTitle')}</p>
              <p className="text-[9px] uppercase tracking-wide text-slate-300">{t('traffic.drivingLicence.document.cardTitleTranslations')}</p>
            </div>
          </div>
          <span className="shrink-0 rounded border border-white/40 px-1.5 py-0.5 text-[10px] font-bold tracking-widest">LS</span>
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
            <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-500">SADC</span>
          </div>

          <dl className="grid flex-1 grid-cols-1 gap-x-3 gap-y-1.5 text-sm">
            <div><dd className="font-bold leading-tight text-slate-900">{record.last_name}</dd></div>
            <div><dd className="mb-1 font-medium leading-tight text-slate-900">{record.first_name} {record.middle_name || ''}</dd></div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('traffic.drivingLicence.document.field.idNo')}: </dt><dd className="inline font-mono font-medium text-slate-900">{record.permanent_identity_number}</dd></div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('traffic.drivingLicence.document.field.birthDate')}: </dt><dd className="inline font-medium text-slate-900">{formatDateOnly(record.date_of_birth)}</dd></div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('traffic.licenceNumber')}: </dt><dd className="inline font-mono font-bold text-slate-900">{record.licence_number || '—'}</dd></div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('traffic.drivingLicence.document.field.validityPeriod')}: </dt><dd className="inline font-medium text-slate-900">{isIssued ? `${formatDateOnly(record.issue_date)} / ${formatDateOnly(record.expiry_date)}` : '—'}</dd></div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('traffic.drivingLicence.document.field.issuingCentre')}: </dt><dd className="inline font-medium text-slate-900">{record.collection_office_district || '—'}</dd></div>
            <div className="flex gap-4">
              <span><dt className="inline text-xs uppercase text-slate-500">{t('traffic.drivingLicence.categoryLabel')}: </dt><dd className="inline font-bold text-slate-900">{record.licence_category || '—'}</dd></span>
              <span><dt className="inline text-xs uppercase text-slate-500">{t('traffic.drivingLicence.document.field.vehicleRestriction')}: </dt><dd className="inline font-medium text-slate-900">{t('traffic.drivingLicence.document.noneValue')}</dd></span>
            </div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('traffic.drivingLicence.document.field.firstIssue')}: </dt><dd className="inline font-medium text-slate-900">{record.first_issue_date ? formatDateOnly(record.first_issue_date) : '—'}</dd></div>
          </dl>
        </div>

        <div className="relative grid grid-cols-2 gap-4 border-t border-dashed border-slate-300 px-4 py-2">
          <div>
            <p className="text-[9px] uppercase tracking-wide text-slate-400">{t('traffic.drivingLicence.document.field.signature')}</p>
            {record.signature_reference ? (
              <img src={`/uploads/${record.signature_reference}`} alt={t('signaturePad.label')} className="h-8 w-28 border-b border-slate-400 object-contain" />
            ) : (
              <div className="h-6 w-28 border-b border-slate-400 text-center text-[8px] uppercase text-slate-400">{t('traffic.drivingLicence.document.signaturePlaceholder')}</div>
            )}
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wide text-slate-400">{t('traffic.drivingLicence.document.field.trafficCommissioner')}</p>
            <div className="ml-auto h-6 w-28 border-b border-slate-400" />
          </div>
        </div>
      </div>

      <div className="card mt-4">
        <p className="mb-4 text-sm text-slate-600">{t(`statusHelp.${record.status}`)}</p>
        {record.rejection_reason && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red">⚠ {record.rejection_reason}</p>
        )}

        {awaitingSurrender && (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">⚠ {t('traffic.drivingLicence.learnerPermitBox.surrenderNotice')}</p>
        )}

        {/* Officer-only: full-size payment proof review — the thing the whole 'confirm-payment'
            action is actually based on. */}
        {isOfficer && (
          <div className="mb-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
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
                title={awaitingSurrender && next.action === 'collect' ? t('traffic.drivingLicence.surrender.confirmBoth') : undefined}
                onClick={() => (next.action === 'collect' ? setSignatureModalOpen(true) : runAction(next.action))}
              >
                {t(next.labelKey)}
              </button>
            )}
            {awaitingSurrender && record.status === 'Ready for Collection' && (
              <button type="button" disabled={busy} className="btn-danger" onClick={() => setModal('surrender-failed')}>
                {t('traffic.drivingLicence.surrender.failed')}
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
        title={modal === 'reject' ? t('common.reject') : modal === 'surrender-failed' ? t('traffic.drivingLicence.surrender.failedModalTitle') : t('common.requestInformation')}
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
        {modal === 'surrender-failed' && <p className="mb-3 text-sm text-slate-600">{t('traffic.drivingLicence.surrender.failedModalHelp')}</p>}
        <label htmlFor="dlDocReason" className="form-label">{t('common.reason')}{modal === 'surrender-failed' && ` (${t('common.optional')})`}</label>
        <textarea id="dlDocReason" className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
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
