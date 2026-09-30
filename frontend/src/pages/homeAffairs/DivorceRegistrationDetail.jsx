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
  'Under Review': { action: 'verify', label: 'Verify' },
};

export default function DivorceRegistrationDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reasonModal, setReasonModal] = useState(null);
  const [reason, setReason] = useState('');
  const [loadError, setLoadError] = useState('');

  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  function load() {
    setLoadError('');
    api.get(`/home-affairs/divorce-registration/${id}`)
      .then((d) => setRecord(d.divorceRegistration))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  async function runAction(action, body = {}) {
    setBusy(true);
    setError('');
    try {
      const result = await api.post(`/home-affairs/divorce-registration/${id}/${action}`, body);
      if (result.certificateNumber) {
        navigate(`/home-affairs/divorce-certificate/${id}`);
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
        <EmptyState icon="⚠" title={t('common.somethingWentWrong')} message={loadError} action={<Link to="/home-affairs/divorce-registration" className="btn-secondary">{t('common.back')}</Link>} />
      </div>
    );
  }
  if (!record) return <Loading />;

  const nextAction = NEXT_ACTION[record.status];
  const canAct = isOfficer && !['Approved', 'Rejected'].includes(record.status);
  const isOwner = record.filer_citizen_id === user.citizenId;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">{t('homeAffairs.divorceRegistration')}</h1>
        <StatusBadge status={record.status} />
      </div>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <p className="mb-4 font-mono text-xs text-slate-400">{record.registration_reference}</p>

      {record.status === 'Approved' && (
        <p className="mb-4">
          <Link to={`/home-affairs/divorce-certificate/${record.divorce_record_id}`} className="btn-primary">{t('homeAffairs.divorceForm.viewCertificate')}</Link>
        </p>
      )}
      {record.status === 'Additional Information Required' && isOwner && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
          ⚠ {t('common.requestInformation')}
          <button type="button" className="ml-3 font-semibold underline" onClick={() => runAction('resubmit')}>{t('common.submit')}</button>
        </div>
      )}

      <div className="card mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.divorceForm.spouseName')}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.divorceForm.spouseName')}</dt><dd className="font-medium">{record.spouse_name}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.divorceForm.spousePermanentId')}</dt><dd className="font-mono font-medium">{record.spouse_permanent_identity_number || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.divorceForm.marriageReference')}</dt><dd className="font-medium">{record.marriage_reference || '—'}</dd></div>
        </dl>
      </div>

      <div className="card mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.divorceForm.courtDetails')}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.divorceForm.courtName')}</dt><dd className="font-medium">{record.court_name}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.divorceForm.courtOrderReference')}</dt><dd className="font-medium">{record.court_order_reference}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.divorceForm.divorceOrderDate')}</dt><dd className="font-medium">{formatDateOnly(record.divorce_order_date)}</dd></div>
        </dl>
      </div>

      <div className="card mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthCertificateView.systemReference')}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.filedBy')}</dt><dd className="font-medium">{record.filer_first_name} {record.filer_last_name}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('auth.permanentIdentityNumber')}</dt><dd className="font-mono font-medium">{record.filer_permanent_identity_number}</dd></div>
        </dl>
      </div>

      {canAct && (
        <div className="card flex flex-wrap gap-3">
          {nextAction && <button type="button" disabled={busy} className="btn-primary" onClick={() => runAction(nextAction.action)}>{nextAction.label}</button>}
          {record.status === 'Verified' && <button type="button" disabled={busy} className="btn-primary" onClick={() => runAction('approve')}>{t('common.approve')}</button>}
          <button type="button" disabled={busy} className="btn-secondary" onClick={() => setReasonModal('request-information')}>{t('common.requestInformation')}</button>
          <button type="button" disabled={busy} className="btn-danger" onClick={() => setReasonModal('reject')}>{t('common.reject')}</button>
        </div>
      )}

      <Modal
        open={!!reasonModal}
        onClose={() => setReasonModal(null)}
        title={reasonModal === 'reject' ? t('common.reject') : t('common.requestInformation')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReasonModal(null)}>{t('common.cancel')}</button>
            <button type="button" className={reasonModal === 'reject' ? 'btn-danger' : 'btn-primary'} disabled={!reason.trim()} onClick={() => runAction(reasonModal, { reason })}>{t('common.confirm')}</button>
          </>
        }
      >
        <label htmlFor="modalReason" className="form-label">{t('common.reason')}</label>
        <textarea id="modalReason" className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}
