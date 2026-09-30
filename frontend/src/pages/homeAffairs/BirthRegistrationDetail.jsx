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

  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  function load() {
    setLoadError('');
    api.get(`/home-affairs/birth-registration/${id}`)
      .then((d) => setRecord(d.birthRegistration))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

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
  const canResubmit = !isOfficer && record.registration_status === 'Information Required';
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

        <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthRegistrationForm.informantDetails')}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.informantName')}</dt><dd className="font-medium">{record.informant_name || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.informantCapacity')}</dt><dd className="font-medium">{record.informant_capacity || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthRegistrationForm.informantResidence')}</dt><dd className="font-medium">{record.informant_residence || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
        </dl>

        <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
          {canResubmit && (
            <button type="button" disabled={busy} className="btn-primary" onClick={() => runAction('resubmit')}>Resubmit for review</button>
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
