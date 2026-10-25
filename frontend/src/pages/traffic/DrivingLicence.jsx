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
import BiometricCapture from '../../components/BiometricCapture';
import DocumentCapture from '../../components/DocumentCapture';
import { formatDateOnly } from '../../utils/format';

// Driving Licence Application / Renewal / Replacement, consolidated onto one page with an
// applicationType selector — the same pattern Passport.jsx uses — instead of the three separate
// DrivingLicenceApply/Renew/Replace.jsx pages this replaces. See migration 067 and
// backend/src/controllers/drivingLicence.controller.js.
//
// Every officer "next step" button here is a real, professional button (btn-primary, compact),
// not a text link — matching the convention the Passport module moved to. View / Request
// Information / Reject stay as the plain text-link secondary actions used throughout the app.
const NEXT = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
  'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
  'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
  'Processing': { action: 'approve', labelKey: 'common.approve' },
  'Approved': { action: 'ready-for-collection', labelKey: 'common.readyForCollection' },
  'Ready for Collection': { action: 'collect', labelKey: 'common.collect' },
};

export default function DrivingLicence() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['traffic_officer', 'system_administrator'].includes(user.roleKey);
  const [records, setRecords] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [eligibilityError, setEligibilityError] = useState('');

  const [applicationType, setApplicationType] = useState('New');
  const [preferredOfficeId, setPreferredOfficeId] = useState('');
  const [biometricsSource, setBiometricsSource] = useState(''); // '' | 'id' | 'new'
  const [photoReference, setPhotoReference] = useState(null);
  const [biometricReferenceLeft, setBiometricReferenceLeft] = useState(null);
  const [biometricReferenceRight, setBiometricReferenceRight] = useState(null);
  const [renewalDamaged, setRenewalDamaged] = useState(false);
  const [damageProofReference, setDamageProofReference] = useState('');
  const [replacementReason, setReplacementReason] = useState('');
  const [previousLicenceNumber, setPreviousLicenceNumber] = useState('');
  const [reportedLostAt, setReportedLostAt] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [modal, setModal] = useState(null); // { id, kind: 'reject' | 'request-information' | 'surrender-failed' }
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState(null);

  function load() { api.get('/traffic/driving-licence').then((d) => setRecords(d.records)); }
  function loadEligibility() {
    if (isOfficer) return;
    api.get('/traffic/driving-licence/eligibility').then(setEligibility).catch((err) => setEligibilityError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); loadEligibility(); }, []);

  useEffect(() => {
    if (!eligibility) return;
    setApplicationType(eligibility.currentLicence ? 'Renewal' : 'New');
  }, [eligibility]);

  function resetForm() {
    setPreferredOfficeId('');
    setBiometricsSource('');
    setPhotoReference(null);
    setBiometricReferenceLeft(null);
    setBiometricReferenceRight(null);
    setRenewalDamaged(false);
    setDamageProofReference('');
    setReplacementReason('');
    setPreviousLicenceNumber('');
    setReportedLostAt('');
    setError('');
  }

  const waitEligibleFrom = reportedLostAt && ['Lost', 'Stolen'].includes(replacementReason)
    ? (() => { const d = new Date(reportedLostAt); d.setUTCMonth(d.getUTCMonth() + (eligibility?.replacementWaitMonths || 3)); return d; })()
    : null;
  const stillWaiting = waitEligibleFrom && waitEligibleFrom > new Date();
  const currentLicenceNotExpired = applicationType === 'Renewal' && eligibility?.currentLicence && !eligibility.currentLicence.isExpired;
  const canApplyNew = applicationType === 'New' && eligibility?.learnerPermit && !eligibility.learnerPermit.isExpired && !eligibility?.currentLicence;

  const submitDisabled =
    !preferredOfficeId ||
    (eligibility?.idCaptureAvailable ? !biometricsSource || (biometricsSource === 'new' && (!photoReference || !biometricReferenceLeft || !biometricReferenceRight))
      : (!photoReference || !biometricReferenceLeft || !biometricReferenceRight)) ||
    (applicationType === 'New' && !canApplyNew) ||
    (applicationType === 'Renewal' && currentLicenceNotExpired && (!renewalDamaged || !damageProofReference)) ||
    (applicationType === 'Replacement' && (!replacementReason || !previousLicenceNumber.trim() ||
      (['Lost', 'Stolen'].includes(replacementReason) && (!reportedLostAt || stillWaiting))));

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (submitDisabled) return;
    try {
      await api.post('/traffic/driving-licence/apply', {
        applicationType, preferredOfficeId,
        biometricsSource: eligibility?.idCaptureAvailable ? biometricsSource : 'new',
        photoReference: biometricsSource === 'id' ? undefined : photoReference,
        biometricReferenceLeft: biometricsSource === 'id' ? undefined : biometricReferenceLeft,
        biometricReferenceRight: biometricsSource === 'id' ? undefined : biometricReferenceRight,
        renewalDamaged: applicationType === 'Renewal' ? renewalDamaged : undefined,
        damageProofReference: applicationType === 'Renewal' ? damageProofReference || undefined : undefined,
        replacementReason: applicationType === 'Replacement' ? replacementReason : undefined,
        previousLicenceNumber: applicationType !== 'New' ? previousLicenceNumber.trim() : undefined,
        reportedLostAt: applicationType === 'Replacement' ? reportedLostAt || undefined : undefined,
      });
      setSuccess(t('services.submitted'));
      resetForm();
      load(); loadEligibility();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); }
  }

  async function transition(id, action) {
    setBusyId(id);
    try {
      await api.post(`/traffic/driving-licence/${id}/${action}`, {});
      setError('');
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally { setBusyId(null); }
  }

  async function submitModal() {
    await api.post(`/traffic/driving-licence/${modal.id}/${modal.kind}`, { reason });
    setModal(null); setReason('');
    load();
  }

  if (!records || (!isOfficer && !eligibility && !eligibilityError)) return <Loading />;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('traffic.drivingLicence.title')}</h1>

      {eligibilityError && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {eligibilityError}</p>}
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      {!isOfficer && eligibility && (
        <form onSubmit={onSubmit} className="card mb-8" noValidate>
          {eligibility.hasInProgressApplication ? (
            <p className="mb-3 text-sm text-gov-amber">⚠ {t('traffic.drivingLicence.inProgress')}</p>
          ) : (
            <>
              <div className="mb-4 max-w-xs">
                <label htmlFor="applicationType" className="form-label">{t('traffic.drivingLicence.applicationTypeLabel')}</label>
                <select id="applicationType" className="form-input" value={applicationType} onChange={(e) => setApplicationType(e.target.value)}>
                  {!eligibility.currentLicence && <option value="New">{t('traffic.drivingLicence.applicationType.New')}</option>}
                  {eligibility.currentLicence && <option value="Renewal">{t('traffic.drivingLicence.applicationType.Renewal')}</option>}
                  {eligibility.currentLicence && <option value="Replacement">{t('traffic.drivingLicence.applicationType.Replacement')}</option>}
                </select>
              </div>

              {applicationType === 'New' && (
                eligibility.learnerPermit && !eligibility.learnerPermit.isExpired ? (
                  <div className="mb-4 rounded-md border border-slate-200 p-4">
                    <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">{t('traffic.drivingLicence.learnerPermitBox.title')}</p>
                    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div><dt className="text-xs text-slate-500">{t('traffic.drivingLicence.learnerPermitBox.number')}</dt><dd className="font-mono font-medium">{eligibility.learnerPermit.licenceNumber}</dd></div>
                      <div><dt className="text-xs text-slate-500">{t('traffic.drivingLicence.learnerPermitBox.expiry')}</dt><dd className="font-medium text-gov-green">{formatDateOnly(eligibility.learnerPermit.expiryDate)}</dd></div>
                    </dl>
                    <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-gov-amber">⚠ {t('traffic.drivingLicence.learnerPermitBox.surrenderNotice')}</p>
                  </div>
                ) : (
                  <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">⚠ {t('traffic.drivingLicence.learnerPermitBox.required')}</p>
                )
              )}

              {applicationType === 'Renewal' && eligibility.currentLicence && (
                <div className="mb-4 rounded-md border border-slate-200 p-4">
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div><dt className="text-xs text-slate-500">{t('traffic.licenceNumber')}</dt><dd className="font-mono font-medium">{eligibility.currentLicence.licenceNumber}</dd></div>
                    <div>
                      <dt className="text-xs text-slate-500">{t('traffic.drivingLicence.expiry')}</dt>
                      <dd className={`font-medium ${eligibility.currentLicence.isExpired ? 'text-gov-red' : 'text-gov-green'}`}>
                        {formatDateOnly(eligibility.currentLicence.expiryDate)} {eligibility.currentLicence.isExpired ? `(${t('homeAffairs.nationalIdRenewReplaceForm.expired')})` : `(${t('homeAffairs.nationalIdRenewReplaceForm.notExpired')})`}
                      </dd>
                    </div>
                  </dl>
                  {currentLicenceNotExpired && (
                    <div className="mt-3">
                      <p className="mb-2 text-sm text-gov-amber">⚠ {t('traffic.drivingLicence.renewal.notYetExpiredNotice', { expiryDate: formatDateOnly(eligibility.currentLicence.expiryDate) })}</p>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input type="checkbox" checked={renewalDamaged} onChange={(e) => setRenewalDamaged(e.target.checked)} />
                        {t('traffic.drivingLicence.renewal.damagedDeclaration')}
                      </label>
                      {renewalDamaged && (
                        <div className="mt-3 rounded-md bg-white p-3">
                          <DocumentCapture label={t('traffic.drivingLicence.renewal.damageProof')} value={damageProofReference} onChange={setDamageProofReference} required />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {applicationType === 'Replacement' && (
                <>
                  <FormFieldLike label={t('traffic.drivingLicenceReplaceForm.field.reason')} required>
                    <select className="form-input" value={replacementReason} onChange={(e) => setReplacementReason(e.target.value)}>
                      <option value="">—</option>
                      <option value="Lost">{t('traffic.replacementReason.lost')}</option>
                      <option value="Stolen">{t('traffic.replacementReason.stolen')}</option>
                      <option value="Damaged">{t('traffic.replacementReason.damaged')}</option>
                      <option value="Other">{t('traffic.replacementReason.other')}</option>
                    </select>
                  </FormFieldLike>
                  <FormFieldLike label={t('traffic.drivingLicenceReplaceForm.field.previousLicenceNumber')} required>
                    <input type="text" className="form-input" value={previousLicenceNumber} onChange={(e) => setPreviousLicenceNumber(e.target.value)} />
                  </FormFieldLike>
                  {['Lost', 'Stolen'].includes(replacementReason) && (
                    <>
                      <FormFieldLike label={t('traffic.drivingLicence.replacement.reportedAt', { reason: t(`traffic.replacementReason.${replacementReason.toLowerCase()}`) })} required>
                        <input type="date" max={new Date().toISOString().slice(0, 10)} className="form-input" value={reportedLostAt} onChange={(e) => setReportedLostAt(e.target.value)} />
                      </FormFieldLike>
                      {reportedLostAt && (
                        stillWaiting ? (
                          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
                            ⚠ {t('traffic.drivingLicence.replacement.waitNotice', { months: eligibility.replacementWaitMonths, date: formatDateOnly(waitEligibleFrom.toISOString().slice(0, 10)) })}
                          </p>
                        ) : (
                          <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {t('traffic.drivingLicence.replacement.waitPassedNotice', { months: eligibility.replacementWaitMonths })}</p>
                        )
                      )}
                    </>
                  )}
                </>
              )}

              {applicationType === 'New' && !canApplyNew ? null : (
                <>
                  {eligibility.idCaptureAvailable ? (
                    <div className="mb-4 rounded-md border border-dashed border-slate-300 p-4">
                      <p className="mb-2 text-sm font-medium text-slate-700">{t('traffic.drivingLicence.biometricsChoice.label')}</p>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
                          <input type="radio" name="biometricsSource" className="mt-1" checked={biometricsSource === 'id'} onChange={() => setBiometricsSource('id')} />
                          <span className="font-medium">{t('traffic.drivingLicence.biometricsChoice.reuseId')}</span>
                        </label>
                        <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
                          <input type="radio" name="biometricsSource" className="mt-1" checked={biometricsSource === 'new'} onChange={() => setBiometricsSource('new')} />
                          <span className="font-medium">{t('traffic.drivingLicence.biometricsChoice.captureNew')}</span>
                        </label>
                      </div>
                      {biometricsSource === 'new' && (
                        <>
                          <PhotoCapture value={photoReference} onChange={setPhotoReference} help={t('photoCapture.idHelp')} faceCheck />
                          <BiometricCapture value={biometricReferenceLeft} onChange={setBiometricReferenceLeft} label={t('biometricCapture.leftHandLabel')} help={t('biometricCapture.scanHint')} hand="left" enrollSource="Driving Licence" />
                          <BiometricCapture value={biometricReferenceRight} onChange={setBiometricReferenceRight} label={t('biometricCapture.rightHandLabel')} help={t('biometricCapture.scanHint')} hand="right" enrollSource="Driving Licence" />
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <PhotoCapture value={photoReference} onChange={setPhotoReference} help={t('photoCapture.idHelp')} faceCheck />
                      <BiometricCapture value={biometricReferenceLeft} onChange={setBiometricReferenceLeft} label={t('biometricCapture.leftHandLabel')} help={t('biometricCapture.scanHint')} hand="left" enrollSource="Driving Licence" />
                      <BiometricCapture value={biometricReferenceRight} onChange={setBiometricReferenceRight} label={t('biometricCapture.rightHandLabel')} help={t('biometricCapture.scanHint')} hand="right" enrollSource="Driving Licence" />
                    </>
                  )}

                  <DistrictOfficeSelect departmentKey="traffic" value={preferredOfficeId} onChange={setPreferredOfficeId} />
                  <button type="submit" disabled={submitDisabled} className="btn-primary">
                    {applicationType === 'Renewal' ? t('traffic.drivingLicence.renew') : applicationType === 'Replacement' ? t('traffic.drivingLicence.replace') : t('traffic.drivingLicence.apply')}
                  </button>
                </>
              )}
            </>
          )}
        </form>
      )}

      <DataTable
        rowKey="traffic_record_id"
        rows={records}
        emptyTitle={t('common.noResults')}
        columns={[
          { key: 'application_reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.application_reference}</span> },
          { key: 'service_type', header: t('traffic.drivingLicence.applicationTypeLabel'), render: (r) => t(`traffic.${r.service_type}`) },
          ...(isOfficer ? [{ key: 'name', header: t('common.citizen'), render: (r) => `${r.first_name} ${r.last_name}` }] : []),
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          { key: 'licence_number', header: t('traffic.licenceNumber'), render: (r) => r.licence_number ? <span className="font-mono text-xs">{r.licence_number}</span> : '—' },
          ...(isOfficer ? [{
            key: 'actions', header: t('common.actions'),
            render: (r) => {
              const next = NEXT[r.status];
              const awaitingSurrender = r.surrender_status === 'Awaiting Surrender';
              const busy = busyId === r.traffic_record_id;
              return (
                <div className="flex flex-wrap gap-2">
                  {next && (
                    <button
                      type="button" disabled={busy}
                      className="btn-primary !whitespace-nowrap !px-3 !py-1.5 !text-xs"
                      title={awaitingSurrender && next.action === 'collect' ? t('traffic.drivingLicence.surrender.confirmBoth') : undefined}
                      onClick={() => transition(r.traffic_record_id, next.action)}
                    >
                      {t(next.labelKey)}
                    </button>
                  )}
                  {awaitingSurrender && r.status === 'Ready for Collection' && (
                    <button type="button" disabled={busy} className="btn-danger !px-3 !py-1.5 !text-xs" onClick={() => setModal({ id: r.traffic_record_id, kind: 'surrender-failed' })}>
                      {t('traffic.drivingLicence.surrender.failed')}
                    </button>
                  )}
                  {!['Rejected', 'Collected'].includes(r.status) && (
                    <>
                      <button type="button" className="text-sm font-medium text-slate-500 hover:underline" onClick={() => setModal({ id: r.traffic_record_id, kind: 'request-information' })}>{t('common.requestInformation')}</button>
                      <button type="button" className="text-sm font-medium text-gov-red hover:underline" onClick={() => setModal({ id: r.traffic_record_id, kind: 'reject' })}>{t('common.reject')}</button>
                    </>
                  )}
                </div>
              );
            },
          }] : []),
        ]}
      />

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.kind === 'reject' ? t('common.reject') : modal?.kind === 'surrender-failed' ? t('traffic.drivingLicence.surrender.failedModalTitle') : t('common.requestInformation')}
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
        {modal?.kind === 'surrender-failed' && <p className="mb-3 text-sm text-slate-600">{t('traffic.drivingLicence.surrender.failedModalHelp')}</p>}
        <label htmlFor="dlReason" className="form-label">{t('common.reason')}{modal?.kind === 'surrender-failed' && ` (${t('common.optional')})`}</label>
        <textarea id="dlReason" className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}

function FormFieldLike({ label, help, required, children }) {
  return (
    <div className="mb-4">
      <label className="form-label">{label}{required && <span className="text-gov-red"> *</span>}</label>
      {children}
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
    </div>
  );
}
