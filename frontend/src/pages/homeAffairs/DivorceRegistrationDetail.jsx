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
  // Feature 4 — editing a rejected/information-required application instead of starting over.
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(null);

  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  function load() {
    setLoadError('');
    api.get(`/home-affairs/divorce-registration/${id}`)
      .then((d) => setRecord(d.divorceRegistration))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  function startEditing(record) {
    setEdit({
      spouseName: record.spouse_name || '', spousePermanentIdentityNumber: record.spouse_permanent_identity_number || '',
      marriageReference: record.marriage_reference || '', courtName: record.court_name || '',
      courtOrderReference: record.court_order_reference || '', divorceOrderDate: record.divorce_order_date ? record.divorce_order_date.slice(0, 10) : '',
    });
    setEditing(true);
  }

  async function submitResubmit() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/home-affairs/divorce-registration/${id}/resubmit`, edit);
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
      {/* Feature 4: citizen can correct and resubmit from Additional Information Required OR Rejected. */}
      {['Additional Information Required', 'Rejected'].includes(record.status) && isOwner && !editing && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
          ⚠ {record.status === 'Rejected' ? t('common.reject') : t('common.requestInformation')}{record.rejection_reason ? `: ${record.rejection_reason}` : ''}
          <button type="button" className="ml-3 font-semibold underline" onClick={() => startEditing(record)}>{t('common.editAndResubmit')}</button>
        </div>
      )}

      {editing ? (
        <div className="card mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.divorceForm.spouseName')}</p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="form-label">{t('homeAffairs.divorceForm.spouseName')}</label><input className="form-input" value={edit.spouseName} onChange={(e) => setEdit({ ...edit, spouseName: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.divorceForm.spousePermanentId')}</label><input className="form-input" value={edit.spousePermanentIdentityNumber} onChange={(e) => setEdit({ ...edit, spousePermanentIdentityNumber: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.divorceForm.marriageReference')}</label><input className="form-input" value={edit.marriageReference} onChange={(e) => setEdit({ ...edit, marriageReference: e.target.value })} /></div>
          </dl>

          <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.divorceForm.courtDetails')}</p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="form-label">{t('homeAffairs.divorceForm.courtName')}</label><input className="form-input" value={edit.courtName} onChange={(e) => setEdit({ ...edit, courtName: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.divorceForm.courtOrderReference')}</label><input className="form-input" value={edit.courtOrderReference} onChange={(e) => setEdit({ ...edit, courtOrderReference: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.divorceForm.divorceOrderDate')}</label><input type="date" className="form-input" value={edit.divorceOrderDate} onChange={(e) => setEdit({ ...edit, divorceOrderDate: e.target.value })} /></div>
          </dl>

          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
            <button type="button" disabled={busy} className="btn-primary" onClick={submitResubmit}>{t('common.resubmitForReview')}</button>
            <button type="button" disabled={busy} className="btn-secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

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