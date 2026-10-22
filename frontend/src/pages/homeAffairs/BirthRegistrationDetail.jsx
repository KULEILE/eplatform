import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import Modal from '../../components/ui/Modal';
import EmptyState from '../../components/ui/EmptyState';
import { formatDateOnly } from '../../utils/format';

const NEXT_ACTION = {
  'Submitted': { action: 'start-review', label: 'Start review' },
  'Under Review': { action: 'verify', label: 'Begin identity verification' },
  'Verification in Progress': { action: 'confirm-verification', label: 'Confirm verification' },
  'Verified': { action: 'approve', label: 'Approve and generate certificate' },
};

export default function BirthRegistrationDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reasonModal, setReasonModal] = useState(null); // 'reject' | 'request-information'
  const [reason, setReason] = useState('');
  const [loadError, setLoadError] = useState('');
  // Feature 4 — editing a rejected/information-required application instead of starting over.
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(null);

  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  function load() {
    setLoadError('');
    api.get(`/home-affairs/birth-registration/${id}`)
      .then((d) => setRecord(d.birthRegistration))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  function startEditing() {
    setEdit({
      childFirstName: record.child_first_name || '', childMiddleName: record.child_middle_name || '', childLastName: record.child_last_name || '',
      dateOfBirth: record.date_of_birth ? record.date_of_birth.slice(0, 10) : '', placeOfBirth: record.place_of_birth || '', sex: record.sex || 'Male',
      fatherName: record.father_name || '', fatherNationality: record.father_nationality || 'Mosotho',
      motherName: record.mother_name || '', motherMaidenSurname: record.mother_maiden_surname || '', motherNationality: record.mother_nationality || 'Mosotho',
      motherResidence: record.mother_residence || '', informantName: record.informant_name || '', informantCapacity: record.informant_capacity || '',
      informantResidence: record.informant_residence || '',
    });
    setEditing(true);
  }

  async function submitResubmit() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/home-affairs/birth-registration/${id}/resubmit`, edit);
      setEditing(false);
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action, body = {}) {
    setBusy(true);
    setError('');
    try {
      const result = await api.post(`/home-affairs/birth-registration/${id}/${action}`, body);
      if (result.certificateNumber) {
        navigate(`/home-affairs/birth-certificate/${result.birthCertificateId}`);
        return;
      }
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
      setReasonModal(null);
      setReason('');
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon="⚠"
          title={t('common.somethingWentWrong')}
          message={loadError}
          action={<Link to="/home-affairs" className="btn-secondary">{t('common.back')}</Link>}
        />
      </div>
    );
  }
  if (!record) return <Loading />;

  const next = isOfficer ? NEXT_ACTION[record.registration_status] : null;
  // Feature 4: a citizen can now correct and resubmit from Rejected too, not just Information Required.
  const canResubmit = !isOfficer && ['Information Required', 'Rejected'].includes(record.registration_status);
  const canReject = isOfficer && !['Approved', 'Rejected'].includes(record.registration_status);
  const canRequestInfo = isOfficer && ['Under Review', 'Verification in Progress'].includes(record.registration_status);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">{t('homeAffairs.birthRegistration')}</h1>
      <p className="mt-1 font-mono text-sm text-slate-500">{record.registration_reference}</p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <div className="card mt-4">
        <div className="mb-4 flex items-center justify-between">
          <StatusBadge status={record.registration_status} />
          {record.birth_certificate_id && (
            <Link to={`/home-affairs/birth-certificate/${record.birth_certificate_id}`} className="text-sm font-medium text-gov-navy hover:underline">
              {t('homeAffairs.birthCertificate')} →
            </Link>
          )}
        </div>
        <p className="mb-4 text-sm text-slate-600">{t(`statusHelp.${record.registration_status}`)}</p>
        {record.rejection_reason && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red">{t('common.reason')}: {record.rejection_reason}</p>
        )}
        {editing ? (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className="form-label">Child's first name</label><input className="form-input" value={edit.childFirstName} onChange={(e) => setEdit({ ...edit, childFirstName: e.target.value })} /></div>
              <div><label className="form-label">Child's middle name</label><input className="form-input" value={edit.childMiddleName} onChange={(e) => setEdit({ ...edit, childMiddleName: e.target.value })} /></div>
              <div><label className="form-label">Child's last name</label><input className="form-input" value={edit.childLastName} onChange={(e) => setEdit({ ...edit, childLastName: e.target.value })} /></div>
              <div><label className="form-label">{t('auth.dateOfBirth')}</label><input type="date" className="form-input" value={edit.dateOfBirth} onChange={(e) => setEdit({ ...edit, dateOfBirth: e.target.value })} /></div>
              <div><label className="form-label">Place of birth</label><input className="form-input" value={edit.placeOfBirth} onChange={(e) => setEdit({ ...edit, placeOfBirth: e.target.value })} /></div>
              <div>
                <label className="form-label">Sex</label>
                <select className="form-input" value={edit.sex} onChange={(e) => setEdit({ ...edit, sex: e.target.value })}>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
            </dl>

            <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthRegistrationForm.fatherDetails')}</p>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className="form-label">{t('homeAffairs.birthRegistrationForm.fatherName')}</label><input className="form-input" value={edit.fatherName} onChange={(e) => setEdit({ ...edit, fatherName: e.target.value })} /></div>
              <div><label className="form-label">{t('homeAffairs.birthRegistrationForm.fatherNationality')}</label><input className="form-input" value={edit.fatherNationality} onChange={(e) => setEdit({ ...edit, fatherNationality: e.target.value })} /></div>
            </dl>

            <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthRegistrationForm.motherDetails')}</p>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className="form-label">{t('homeAffairs.birthRegistrationForm.motherName')}</label><input className="form-input" value={edit.motherName} onChange={(e) => setEdit({ ...edit, motherName: e.target.value })} /></div>
              <div><label className="form-label">{t('homeAffairs.birthRegistrationForm.motherMaidenSurname')}</label><input className="form-input" value={edit.motherMaidenSurname} onChange={(e) => setEdit({ ...edit, motherMaidenSurname: e.target.value })} /></div>
              <div><label className="form-label">{t('homeAffairs.birthRegistrationForm.motherNationality')}</label><input className="form-input" value={edit.motherNationality} onChange={(e) => setEdit({ ...edit, motherNationality: e.target.value })} /></div>
              <div><label className="form-label">{t('homeAffairs.birthRegistrationForm.motherResidence')}</label><input className="form-input" value={edit.motherResidence} onChange={(e) => setEdit({ ...edit, motherResidence: e.target.value })} /></div>
            </dl>

            <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthRegistrationForm.informantDetails')}</p>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><label className="form-label">{t('homeAffairs.birthRegistrationForm.informantName')}</label><input className="form-input" value={edit.informantName} onChange={(e) => setEdit({ ...edit, informantName: e.target.value })} /></div>
              <div><label className="form-label">{t('homeAffairs.birthRegistrationForm.informantCapacity')}</label><input className="form-input" value={edit.informantCapacity} onChange={(e) => setEdit({ ...edit, informantCapacity: e.target.value })} /></div>
              <div><label className="form-label">{t('homeAffairs.birthRegistrationForm.informantResidence')}</label><input className="form-input" value={edit.informantResidence} onChange={(e) => setEdit({ ...edit, informantResidence: e.target.value })} /></div>
            </dl>

            <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
              <button type="button" disabled={busy} className="btn-primary" onClick={submitResubmit}>{t('common.resubmitForReview')}</button>
              <button type="button" disabled={busy} className="btn-secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
            </div>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Child's name</dt><dd className="font-medium">{record.child_first_name} {record.child_middle_name} {record.child_last_name}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('auth.dateOfBirth')}</dt><dd className="font-medium">{formatDateOnly(record.date_of_birth)}</dd></div>
              <div><dt className="text-xs text-slate-500">Place of birth</dt><dd className="font-medium">{record.place_of_birth}</dd></div>
              <div><dt className="text-xs text-slate-500">Sex</dt><dd className="font-medium">{record.sex}</dd></div>
            </dl>

            <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthRegistrationForm.fatherDetails')}</p>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.fatherName')}</dt><dd className="font-medium">{record.father_name || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.fatherNationality')}</dt><dd className="font-medium">{record.father_nationality || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
            </dl>

            <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthRegistrationForm.motherDetails')}</p>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.motherName')}</dt><dd className="font-medium">{record.mother_name || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.motherMaidenSurname')}</dt><dd className="font-medium">{record.mother_maiden_surname || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.motherNationality')}</dt><dd className="font-medium">{record.mother_nationality || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.motherResidence')}</dt><dd className="font-medium">{record.mother_residence || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
            </dl>

            {/* Identity-check fields and supporting documents only exist on applications submitted
                through the new automatic flow (migration 059) — a pre-existing record from the old
                manual flow simply has nulls here, so this section quietly shows nothing for those. */}
            {(record.father_identity_number || record.father_passport_number || record.mother_identity_number || record.mother_passport_number) && (
              <>
                <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthRegistrationForm.isCitizen')}</p>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.fatherDetails')}</dt>
                    <dd className="font-medium">
                      {record.father_is_citizen
                        ? `${t('homeAffairs.birthRegistrationForm.identityNumber')}: ${record.father_identity_number}`
                        : `${t('homeAffairs.birthRegistrationForm.passportNumber')}: ${record.father_passport_number || t('homeAffairs.birthCertificateView.notRecorded')}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.motherDetails')}</dt>
                    <dd className="font-medium">
                      {record.mother_is_citizen
                        ? `${t('homeAffairs.birthRegistrationForm.identityNumber')}: ${record.mother_identity_number}`
                        : `${t('homeAffairs.birthRegistrationForm.passportNumber')}: ${record.mother_passport_number || t('homeAffairs.birthCertificateView.notRecorded')}`}
                    </dd>
                  </div>
                </dl>
              </>
            )}

            {(record.chief_letter_image_reference || record.proof_of_birth_image_reference || record.marriage_certificate_image_reference || record.acknowledgement_of_paternity_image_reference) && (
              <>
                <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthRegistrationForm.uploadDocuments')}</p>
                <ul className="flex flex-wrap gap-4">
                  {record.chief_letter_image_reference && (
                    <li><a className="text-sm font-medium text-gov-navy hover:underline" href={`/uploads/${record.chief_letter_image_reference}`} target="_blank" rel="noreferrer">{t('homeAffairs.birthRegistrationForm.chiefLetter')}</a></li>
                  )}
                  {record.proof_of_birth_image_reference && (
                    <li><a className="text-sm font-medium text-gov-navy hover:underline" href={`/uploads/${record.proof_of_birth_image_reference}`} target="_blank" rel="noreferrer">{t('homeAffairs.birthRegistrationForm.proofOfBirth')}</a></li>
                  )}
                  {record.marriage_certificate_image_reference && (
                    <li><a className="text-sm font-medium text-gov-navy hover:underline" href={`/uploads/${record.marriage_certificate_image_reference}`} target="_blank" rel="noreferrer">{t('homeAffairs.birthRegistrationForm.marriageCertificate')}</a></li>
                  )}
                  {record.acknowledgement_of_paternity_image_reference && (
                    <li><a className="text-sm font-medium text-gov-navy hover:underline" href={`/uploads/${record.acknowledgement_of_paternity_image_reference}`} target="_blank" rel="noreferrer">{t('homeAffairs.birthRegistrationForm.acknowledgementOfPaternity')}</a></li>
                  )}
                </ul>
              </>
            )}

            <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthRegistrationForm.informantDetails')}</p>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.informantName')}</dt><dd className="font-medium">{record.informant_name || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.informantCapacity')}</dt><dd className="font-medium">{record.informant_capacity || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.informantResidence')}</dt><dd className="font-medium">{record.informant_residence || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
            </dl>

            <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
              {canResubmit && (
                <button type="button" disabled={busy} className="btn-primary" onClick={startEditing}>{t('common.editAndResubmit')}</button>
              )}
              {next && (
                <button type="button" disabled={busy} className="btn-primary" onClick={() => runAction(next.action)}>{next.label}</button>
              )}
              {canRequestInfo && (
                <button type="button" disabled={busy} className="btn-secondary" onClick={() => setReasonModal('request-information')}>{t('common.requestInformation')}</button>
              )}
              {canReject && (
                <button type="button" disabled={busy} className="btn-danger" onClick={() => setReasonModal('reject')}>{t('common.reject')}</button>
              )}
            </div>
          </>
        )}
      </div>

      <Modal
        open={!!reasonModal}
        onClose={() => setReasonModal(null)}
        title={reasonModal === 'reject' ? t('common.reject') : t('common.requestInformation')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReasonModal(null)}>{t('common.cancel')}</button>
            <button
              type="button"
              className={reasonModal === 'reject' ? 'btn-danger' : 'btn-primary'}
              disabled={!reason.trim() || busy}
              onClick={() => runAction(reasonModal, { reason })}
            >
              {t('common.confirm')}
            </button>
          </>
        }
      >
        <label htmlFor="reason" className="form-label">{t('common.reason')}</label>
        <textarea id="reason" className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}
