import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import Modal from '../../components/ui/Modal';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';
import PhotoCapture from '../../components/PhotoCapture';
import DocumentCapture from '../../components/DocumentCapture';
import ReceiptCapture from '../../components/ReceiptCapture';
import SignaturePad from '../../components/SignaturePad';
import { formatDateOnly } from '../../utils/format';

// Batch 13: every pre-production status now collapses onto the single 'confirm' action — the
// officer reviews the payment reference and proof shown alongside the application (see
// PassportDocument.jsx), and confirming jumps straight to 'Passport Produced'. The backend
// enforces a first-submitted-first-confirmed order on this action to prevent favouritism; a
// blocked attempt comes back as a normal API error, caught below and shown in the error banner.
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

const emptyReceipt = { paymentReference: '', receiptImageReference: '' };

/**
 * Rewritten for the client's enhancement (see migration 064):
 *  - 16+ only, and an adult applying for THEMSELVES must already hold a collected National ID
 *    card — enforced server-side, surfaced here from GET /passport/eligibility.
 *  - A parent can apply on behalf of a child under 16, but only a child genuinely linked to them
 *    on a birth record — the "who is this for" picker below is built from that real list, not a
 *    typed citizen ID, so there's no way to even attempt an unrelated child.
 *  - The photo can be reused from the subject's National ID photo, or a fresh one captured — an
 *    explicit choice every time (children never get the reuse option, since they have no ID).
 *  - The subject's current passport (if any) is always shown before choosing Renewal/Replacement.
 *  - Renewal is blocked unless the current passport has expired, unless the citizen declares its
 *    pages are full. Replacement (Lost/Stolen) requires proof and a 3-month wait from the date
 *    reported — same shape as National ID replacement.
 */
export default function Passport() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['passport_officer', 'system_administrator'].includes(user.roleKey);
  const [records, setRecords] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [eligibilityError, setEligibilityError] = useState('');

  const [subjectChoice, setSubjectChoice] = useState('self'); // 'self' | String(childCitizenId)
  const [applicationType, setApplicationType] = useState('New');
  const [passportType, setPassportType] = useState('Ordinary');
  const [preferredOfficeId, setPreferredOfficeId] = useState('');
  const [photoSource, setPhotoSource] = useState(''); // '' | 'id' | 'new'
  const [photoReference, setPhotoReference] = useState(null);
  const [pagesFullAcknowledged, setPagesFullAcknowledged] = useState(false);
  const [pagesFullPageCount, setPagesFullPageCount] = useState('');
  const [pagesFullProofReference, setPagesFullProofReference] = useState('');
  const [enteredPassportNumber, setEnteredPassportNumber] = useState('');
  const [replacementReason, setReplacementReason] = useState('');
  const [replacementDetails, setReplacementDetails] = useState('');
  const [replacementProofReference, setReplacementProofReference] = useState('');
  const [reportedLostAt, setReportedLostAt] = useState('');
  const [receipt, setReceipt] = useState(emptyReceipt);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState('');
  const [signatureModal, setSignatureModal] = useState(null); // passport_record_id | null
  const [signatureReference, setSignatureReference] = useState(null);
  // Feature 4 — editing a rejected/information-required application instead of starting a new
  // one. When set, the form above switches to editing that record and submits to /resubmit.
  const [resubmitTarget, setResubmitTarget] = useState(null);

  function load() { api.get('/passport').then((d) => setRecords(d.passportRecords)); }
  function loadEligibility() {
    if (isOfficer) return;
    api.get('/passport/eligibility').then(setEligibility).catch((err) => setEligibilityError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); loadEligibility(); }, []);

  // The subject this application is for — the citizen themselves, or the chosen child.
  const subject = !eligibility ? null
    : subjectChoice === 'self' ? eligibility.self
    : eligibility.children.find((c) => String(c.citizenId) === subjectChoice) || null;
  const isOnBehalf = subjectChoice !== 'self';
  const idPhotoAvailable = !isOnBehalf && !!subject?.idPhotoReference;
  const canApplyForSelf = eligibility?.self?.meetsMinimumAge;
  const hasAnyChildOptions = eligibility && eligibility.children.length > 0;

  function resetForm() {
    setResubmitTarget(null);
    setApplicationType('New');
    setPassportType('Ordinary');
    setPreferredOfficeId('');
    setPhotoSource('');
    setPhotoReference(null);
    setPagesFullAcknowledged(false);
    setPagesFullPageCount('');
    setPagesFullProofReference('');
    setEnteredPassportNumber('');
    setReplacementReason('');
    setReplacementDetails('');
    setReplacementProofReference('');
    setReportedLostAt('');
    setReceipt(emptyReceipt);
    setError('');
  }

  function startResubmit(record) {
    setResubmitTarget(record);
    setPassportType(record.passport_type || 'Ordinary');
    setPreferredOfficeId(record.preferred_office_id || record.collection_office_id || '');
    setPhotoReference(record.photo_reference || null);
    setReceipt({ paymentReference: record.payment_reference || '', receiptImageReference: record.receipt_image_reference || '' });
    setError('');
  }

  // Once eligibility loads, default applicationType to whatever is actually available for the
  // currently-chosen subject (New if they have no current passport, Renewal otherwise).
  useEffect(() => {
    if (!subject) return;
    setApplicationType(subject.hasCurrentPassport ? 'Renewal' : 'New');
    setPhotoSource('');
    setPhotoReference(null);
    setPagesFullAcknowledged(false);
    setPagesFullPageCount('');
    setPagesFullProofReference('');
    setEnteredPassportNumber('');
  }, [subjectChoice, eligibility]);

  const waitEligibleFrom = reportedLostAt && applicationType === 'Replacement'
    ? (() => { const d = new Date(reportedLostAt); d.setUTCMonth(d.getUTCMonth() + (eligibility?.replacementWaitMonths || 3)); return d; })()
    : null;
  const stillWaiting = waitEligibleFrom && waitEligibleFrom > new Date();
  const currentPassportNotExpired = applicationType === 'Renewal' && subject?.currentPassport && !subject.currentPassport.isExpired;

  const submitDisabled =
    !preferredOfficeId ||
    !receipt.paymentReference.trim() || !receipt.receiptImageReference ||
    (idPhotoAvailable ? !photoSource || (photoSource === 'new' && !photoReference) : !photoReference) ||
    (currentPassportNotExpired && (!pagesFullAcknowledged || !pagesFullPageCount || Number(pagesFullPageCount) <= 0 || !pagesFullProofReference || !enteredPassportNumber.trim())) ||
    (applicationType === 'Replacement' && (!replacementReason || !reportedLostAt || !replacementProofReference || stillWaiting));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (resubmitTarget) {
      if (!preferredOfficeId) { setError(t('offices.chooseBranchRequired')); return; }
      if (!photoReference) { setError(t('photoCapture.required')); return; }
      if (!receipt.paymentReference.trim() || !receipt.receiptImageReference) { setError(t('receiptCapture.required')); return; }
      try {
        await api.post(`/passport/${resubmitTarget.passport_record_id}/resubmit`, {
          passportType, preferredOfficeId, photoReference,
          paymentReference: receipt.paymentReference.trim(), receiptImageReference: receipt.receiptImageReference,
        });
        resetForm(); load(); loadEligibility();
      } catch (err) { setError(err.message || t('common.somethingWentWrong')); }
      return;
    }

    if (submitDisabled) return;
    try {
      const base = {
        subjectCitizenId: isOnBehalf ? subject.citizenId : undefined,
        passportType, preferredOfficeId,
        photoSource: idPhotoAvailable ? photoSource : 'new',
        photoReference: photoSource === 'id' ? undefined : photoReference,
        paymentReference: receipt.paymentReference.trim(), receiptImageReference: receipt.receiptImageReference,
      };
      if (applicationType === 'New') {
        await api.post('/passport/apply', base);
      } else if (applicationType === 'Renewal') {
        await api.post('/passport/renew', {
          ...base,
          renewalReason: subject.currentPassport.isExpired ? undefined : 'Pages Full',
          pagesFullPageCount: subject.currentPassport.isExpired ? undefined : Number(pagesFullPageCount),
          pagesFullProofReference: subject.currentPassport.isExpired ? undefined : pagesFullProofReference,
          enteredPassportNumber: subject.currentPassport.isExpired ? undefined : enteredPassportNumber.trim(),
        });
      } else {
        await api.post('/passport/replace', {
          ...base, replacementReason, replacementDetails: replacementDetails || undefined,
          replacementProofReference, reportedLostAt,
        });
      }
      resetForm();
      setSubjectChoice('self');
      load(); loadEligibility();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    }
  }

  async function transition(id, action) {
    try {
      await api.post(`/passport/${id}/${action}`, {});
      setError('');
      load();
    } catch (err) {
      // Batch 13: the 'confirm' action can legitimately be blocked (first-submitted-first-
      // confirmed order) — surface that explanation instead of failing silently.
      setError(err.message || t('common.somethingWentWrong'));
    }
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

  if (!records || (!isOfficer && !eligibility && !eligibilityError)) return <Loading />;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('passport.title')}</h1>

      {eligibilityError && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {eligibilityError}</p>}
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      {!isOfficer && eligibility && (
        <form onSubmit={onSubmit} className="card mb-8">
          {resubmitTarget ? (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
              <span>
                ✎ {t('common.editAndResubmit')} — <span className="font-mono text-xs">{resubmitTarget.application_reference}</span>
                {resubmitTarget.rejection_reason ? `: ${resubmitTarget.rejection_reason}` : ''}
              </span>
              <button type="button" className="font-semibold underline" onClick={resetForm}>{t('common.cancel')}</button>
            </div>
          ) : (
            <>
              {hasAnyChildOptions && (
                <div className="mb-4 max-w-sm">
                  <label htmlFor="subjectChoice" className="form-label">{t('passport.subject.label')}</label>
                  <select id="subjectChoice" className="form-input" value={subjectChoice} onChange={(e) => setSubjectChoice(e.target.value)}>
                    {canApplyForSelf && <option value="self">{t('passport.subject.myself')}</option>}
                    {eligibility.children.map((c) => (
                      <option key={c.citizenId} value={String(c.citizenId)}>
                        {[c.firstName, c.lastName].filter(Boolean).join(' ')} ({t('passport.subject.age', { age: c.age })})
                      </option>
                    ))}
                  </select>
                  {!canApplyForSelf && subjectChoice === 'self' && (
                    <p className="mt-1 text-xs text-gov-amber">⚠ {t('passport.subject.selfTooYoung', { minimumAge: eligibility.minimumAge })}</p>
                  )}
                </div>
              )}

              {!subject ? (
                <p className="mb-3 text-sm text-gov-amber">⚠ {t('passport.subject.chooseSomeone')}</p>
              ) : !isOnBehalf && !canApplyForSelf ? (
                <p className="mb-3 text-sm text-gov-amber">⚠ {t('passport.subject.selfTooYoung', { minimumAge: eligibility.minimumAge })}</p>
              ) : isOnBehalf && !subject.canApplyOnBehalf ? (
                <p className="mb-3 text-sm text-gov-amber">⚠ {t('passport.subject.childTooOld', { age: subject.age })}</p>
              ) : subject.hasInProgressApplication ? (
                <p className="mb-3 text-sm text-gov-amber">⚠ {isOnBehalf ? t('passport.subject.childInProgress') : t('passport.subject.selfInProgress')}</p>
              ) : !isOnBehalf && !subject.hasCollectedNationalId && !subject.hasCurrentPassport ? (
                <p className="mb-3 text-sm text-gov-amber">⚠ {t('passport.subject.idRequired')}</p>
              ) : (
                <>
                  {subject.hasCurrentPassport && (
                    <div className="mb-4 rounded-md border border-slate-200 p-4">
                      <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">{t('passport.subject.currentPassport')}</p>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <div className="flex h-32 w-28 flex-none items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                          {subject.currentPassport.photoReference ? (
                            <img src={`/uploads/${subject.currentPassport.photoReference}`} alt={t('photoCapture.previewAlt')} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-3xl text-slate-300" aria-hidden="true">👤</span>
                          )}
                        </div>
                        <dl className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                          <div><dt className="text-xs text-slate-500">{t('passport.passportNumber')}</dt><dd className="font-mono font-medium">{subject.currentPassport.passportNumber}</dd></div>
                          <div><dt className="text-xs text-slate-500">{t('passport.type')}</dt><dd className="font-medium">{t(`passport.${(subject.currentPassport.passportType || 'Ordinary').toLowerCase()}`)}</dd></div>
                          <div><dt className="text-xs text-slate-500">{t('passport.document.field.dateOfIssue')}</dt><dd className="font-medium">{formatDateOnly(subject.currentPassport.issueDate)}</dd></div>
                          <div>
                            <dt className="text-xs text-slate-500">{t('passport.expiryDate')}</dt>
                            <dd className={`font-medium ${subject.currentPassport.isExpired ? 'text-gov-red' : 'text-gov-green'}`}>
                              {formatDateOnly(subject.currentPassport.expiryDate)} {subject.currentPassport.isExpired ? `(${t('homeAffairs.nationalIdRenewReplaceForm.expired')})` : `(${t('homeAffairs.nationalIdRenewReplaceForm.notExpired')})`}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  )}

                  <div className="mb-4 max-w-xs">
                    <label htmlFor="applicationType" className="form-label">{t('passport.applicationTypeLabel')}</label>
                    <select id="applicationType" className="form-input" value={applicationType} onChange={(e) => setApplicationType(e.target.value)}>
                      {!subject.hasCurrentPassport && <option value="New">{t('passport.applicationType.New')}</option>}
                      {subject.hasCurrentPassport && <option value="Renewal">{t('passport.applicationType.Renewal')}</option>}
                      {subject.hasCurrentPassport && <option value="Replacement">{t('passport.applicationType.Replacement')}</option>}
                    </select>
                  </div>

                  {applicationType === 'Renewal' && currentPassportNotExpired && (
                    <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
                      <p className="mb-2">⚠ {t('passport.renewal.notYetExpiredNotice', { expiryDate: formatDateOnly(subject.currentPassport.expiryDate) })}</p>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" checked={pagesFullAcknowledged} onChange={(e) => setPagesFullAcknowledged(e.target.checked)} />
                        {t('passport.renewal.pagesFullDeclaration')}
                      </label>
                      {pagesFullAcknowledged && (
                        <div className="mt-3 rounded-md bg-white p-3">
                          <FormFieldLike label={t('passport.renewal.field.confirmPassportNumber')} help={t('passport.renewal.field.confirmPassportNumberHelp')} required>
                            <input
                              type="text" className="form-input max-w-[14rem] font-mono uppercase"
                              value={enteredPassportNumber} onChange={(e) => setEnteredPassportNumber(e.target.value)}
                            />
                          </FormFieldLike>
                          <FormFieldLike label={t('passport.renewal.field.pageCount')} required>
                            <input
                              type="number" min="1" className="form-input max-w-[10rem]"
                              value={pagesFullPageCount} onChange={(e) => setPagesFullPageCount(e.target.value)}
                            />
                          </FormFieldLike>
                          <DocumentCapture
                            label={t('passport.renewal.field.lastPageProof')}
                            help={t('passport.renewal.field.lastPageProofHelp')}
                            value={pagesFullProofReference}
                            onChange={setPagesFullProofReference}
                            required
                            requireLiveCapture
                          />
                          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-gov-amber">
                            ⚠ {t('passport.renewal.surrenderNotice')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {applicationType === 'Replacement' && (
                    <>
                      <FormFieldLike label={t('passport.replacement.field.reason')} required>
                        <select className="form-input" value={replacementReason} onChange={(e) => setReplacementReason(e.target.value)}>
                          <option value="">—</option>
                          <option value="Lost">{t('homeAffairs.replacementReason.lost')}</option>
                          <option value="Stolen">{t('homeAffairs.replacementReason.stolen')}</option>
                        </select>
                      </FormFieldLike>
                      <FormFieldLike label={t('passport.replacement.field.details')} help={t('common.optional')}>
                        <textarea rows={3} className="form-input" value={replacementDetails} onChange={(e) => setReplacementDetails(e.target.value)} />
                      </FormFieldLike>
                      {replacementReason && (
                        <>
                          <FormFieldLike label={t('passport.replacement.field.reportedAt', { reason: t(`homeAffairs.replacementReason.${replacementReason.toLowerCase()}`) })} required>
                            <input type="date" max={new Date().toISOString().slice(0, 10)} className="form-input" value={reportedLostAt} onChange={(e) => setReportedLostAt(e.target.value)} />
                          </FormFieldLike>
                          {reportedLostAt && (
                            stillWaiting ? (
                              <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
                                ⚠ {t('passport.replacement.waitNotice', { months: eligibility.replacementWaitMonths, date: formatDateOnly(waitEligibleFrom.toISOString().slice(0, 10)) })}
                              </p>
                            ) : (
                              <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {t('passport.replacement.waitPassedNotice', { months: eligibility.replacementWaitMonths })}</p>
                            )
                          )}
                        </>
                      )}
                      <DocumentCapture
                        label={t('passport.replacement.field.proof')}
                        help={t('passport.replacement.field.proofHelp')}
                        value={replacementProofReference}
                        onChange={setReplacementProofReference}
                        required
                      />
                    </>
                  )}

                  <div className="mb-4 max-w-xs">
                    <label htmlFor="passportType" className="form-label">{t('passport.type')}</label>
                    <select id="passportType" className="form-input" value={passportType} onChange={(e) => setPassportType(e.target.value)}>
                      <option value="Ordinary">{t('passport.ordinary')}</option>
                      <option value="Diplomatic">{t('passport.diplomatic')}</option>
                      <option value="Official">{t('passport.official')}</option>
                    </select>
                  </div>

                  {idPhotoAvailable ? (
                    <div className="mb-4 rounded-md border border-dashed border-slate-300 p-4">
                      <p className="mb-2 text-sm font-medium text-slate-700">{t('passport.photoChoice.label')}</p>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
                          <input type="radio" name="photoSource" className="mt-1" checked={photoSource === 'id'} onChange={() => setPhotoSource('id')} />
                          <span>
                            <span className="block font-medium">{t('passport.photoChoice.reuseId')}</span>
                            <img src={`/uploads/${subject.idPhotoReference}`} alt={t('photoCapture.previewAlt')} className="mt-2 h-20 w-16 rounded border border-slate-200 object-cover" />
                          </span>
                        </label>
                        <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
                          <input type="radio" name="photoSource" className="mt-1" checked={photoSource === 'new'} onChange={() => setPhotoSource('new')} />
                          <span className="font-medium">{t('passport.photoChoice.captureNew')}</span>
                        </label>
                      </div>
                      {photoSource === 'new' && <PhotoCapture value={photoReference} onChange={setPhotoReference} help={t('photoCapture.idHelp')} faceCheck />}
                    </div>
                  ) : (
                    <PhotoCapture value={photoReference} onChange={setPhotoReference} help={t('photoCapture.idHelp')} faceCheck />
                  )}

                  <ReceiptCapture value={receipt} onChange={setReceipt} help={t('passport.feeNotice')} />
                  <DistrictOfficeSelect departmentKey="passport" value={preferredOfficeId} onChange={setPreferredOfficeId} />
                  <button type="submit" disabled={submitDisabled} className="btn-primary">
                    {applicationType === 'Renewal' ? t('passport.renew') : applicationType === 'Replacement' ? t('passport.replace') : t('passport.apply')}
                  </button>
                </>
              )}
            </>
          )}

          {resubmitTarget && (
            <>
              <div className="mb-4 max-w-xs">
                <label htmlFor="passportTypeResubmit" className="form-label">{t('passport.type')}</label>
                <select id="passportTypeResubmit" className="form-input" value={passportType} onChange={(e) => setPassportType(e.target.value)}>
                  <option value="Ordinary">{t('passport.ordinary')}</option>
                  <option value="Diplomatic">{t('passport.diplomatic')}</option>
                  <option value="Official">{t('passport.official')}</option>
                </select>
              </div>
              <PhotoCapture value={photoReference} onChange={setPhotoReference} help={t('photoCapture.idHelp')} faceCheck />
              <ReceiptCapture value={receipt} onChange={setReceipt} help={t('passport.feeNotice')} />
              <DistrictOfficeSelect departmentKey="passport" value={preferredOfficeId} onChange={setPreferredOfficeId} />
              <button type="submit" className="btn-primary">{t('common.resubmitForReview')}</button>
            </>
          )}
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
          { key: 'application_type', header: t('passport.applicationTypeLabel'), render: (r) => t(`passport.applicationType.${r.application_type || 'New'}`) },
          { key: 'holder', header: t('passport.subject.holderColumn'), render: (r) => isOfficer ? `${r.first_name} ${r.last_name}` : (r.subject_first_name ? `${r.subject_first_name} ${r.subject_last_name}` : '—') },
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
              const awaitingSurrender = r.surrender_status === 'Awaiting Surrender';
              return (
                <div className="flex flex-wrap gap-2">
                  <Link to={`/passport/${r.passport_record_id}`} className="text-sm font-medium text-gov-navy hover:underline">{t('common.view')}</Link>
                  {next && (
                    <button
                      type="button"
                      className="text-sm font-medium text-gov-navy hover:underline"
                      onClick={() => (next.action === 'collect' ? setSignatureModal(r.passport_record_id) : transition(r.passport_record_id, next.action))}
                    >
                      {awaitingSurrender && next.action === 'confirm' ? t('passport.surrender.confirmBoth') : t(next.labelKey)}
                    </button>
                  )}
                  {awaitingSurrender && (
                    <button type="button" className="text-sm font-medium text-gov-red hover:underline" onClick={() => setModal({ id: r.passport_record_id, kind: 'surrender-failed' })}>
                      {t('passport.surrender.failed')}
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
            render: (r) => (
              <div className="flex flex-wrap gap-2">
                <Link to={`/passport/${r.passport_record_id}`} className="text-sm font-medium text-gov-navy hover:underline">{t('common.view')}</Link>
                {['Additional Information Required', 'Rejected'].includes(r.status) && (
                  <button
                    type="button"
                    className="text-sm font-medium text-gov-navy hover:underline"
                    onClick={() => { startResubmit(r); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  >
                    {t('common.editAndResubmit')}
                  </button>
                )}
              </div>
            ),
          }]),
        ]}
      />

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.kind === 'reject' ? t('common.reject') : modal?.kind === 'surrender-failed' ? t('passport.surrender.failedModalTitle') : t('common.requestInformation')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
            <button
              type="button"
              className={modal?.kind === 'reject' || modal?.kind === 'surrender-failed' ? 'btn-danger' : 'btn-primary'}
              disabled={modal?.kind !== 'surrender-failed' && !reason.trim()}
              onClick={submitModal}
            >
              {t('common.confirm')}
            </button>
          </>
        }
      >
        {modal?.kind === 'surrender-failed' && <p className="mb-3 text-sm text-slate-600">{t('passport.surrender.failedModalHelp')}</p>}
        <label htmlFor="passportReason" className="form-label">{t('common.reason')}{modal?.kind === 'surrender-failed' && ` (${t('common.optional')})`}</label>
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

/** A minimal label+help wrapper matching FormField's look, used here instead of FormField itself
 *  because these replacement fields have no stable htmlFor id worth wiring up (several are
 *  conditionally rendered) — same trade-off NationalIdRenewReplace.jsx makes for its own
 *  replacement fields. */
function FormFieldLike({ label, help, required, children }) {
  return (
    <div className="mb-4">
      <label className="form-label">{label}{required && <span className="text-gov-red"> *</span>}</label>
      {children}
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}
