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

export default function MarriageRegistrationDetail() {
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
    api.get(`/home-affairs/marriage-registration/${id}`)
      .then((d) => setRecord(d.marriageRegistration))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  function startEditing(record) {
    setEdit({
      spouse2Name: record.spouse2_name || '', spouse2DateOfBirth: record.spouse2_date_of_birth ? record.spouse2_date_of_birth.slice(0, 10) : '',
      spouse2Nationality: record.spouse2_nationality || 'Mosotho', spouse2PermanentIdentityNumber: record.spouse2_permanent_identity_number || '',
      marriageType: record.marriage_type || 'Civil', marriageDate: record.marriage_date ? record.marriage_date.slice(0, 10) : '',
      placeOfMarriage: record.place_of_marriage || '', witness1Name: record.witness1_name || '', witness2Name: record.witness2_name || '',
      officiantName: record.officiant_name || '',
    });
    setEditing(true);
  }

  async function submitResubmit() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/home-affairs/marriage-registration/${id}/resubmit`, edit);
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
      const result = await runPost(action, body);
      if (result.certificateNumber) {
        navigate(`/home-affairs/marriage-certificate/${id}`);
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

  function runPost(action, body) {
    return api.post(`/home-affairs/marriage-registration/${id}/${action}`, body);
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState icon="⚠" title={t('common.somethingWentWrong')} message={loadError} action={<Link to="/home-affairs/marriage-registration" className="btn-secondary">{t('common.back')}</Link>} />
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
        <h1 className="text-2xl font-bold text-slate-900">{t('homeAffairs.marriageRegistration')}</h1>
        <StatusBadge status={record.status} />
      </div>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <p className="mb-4 font-mono text-xs text-slate-400">{record.registration_reference}</p>

      {record.status === 'Approved' && (
        <p className="mb-4">
          <Link to={`/home-affairs/marriage-certificate/${record.marriage_record_id}`} className="btn-primary">{t('homeAffairs.marriageForm.viewCertificate')}</Link>
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
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.marriageForm.spouseDetails')}</p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="form-label">{t('homeAffairs.marriageForm.spouseName')}</label><input className="form-input" value={edit.spouse2Name} onChange={(e) => setEdit({ ...edit, spouse2Name: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.marriageForm.spouseDateOfBirth')}</label><input type="date" className="form-input" value={edit.spouse2DateOfBirth} onChange={(e) => setEdit({ ...edit, spouse2DateOfBirth: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.marriageForm.spouseNationality')}</label><input className="form-input" value={edit.spouse2Nationality} onChange={(e) => setEdit({ ...edit, spouse2Nationality: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.marriageForm.spousePermanentId')}</label><input className="form-input" value={edit.spouse2PermanentIdentityNumber} onChange={(e) => setEdit({ ...edit, spouse2PermanentIdentityNumber: e.target.value })} /></div>
          </dl>

          <p className="mb-2 mt-5 border-t border-slate-100 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.marriageForm.title')}</p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="form-label">{t('homeAffairs.marriageForm.marriageType')}</label>
              <select className="form-input" value={edit.marriageType} onChange={(e) => setEdit({ ...edit, marriageType: e.target.value })}>
                <option value="Civil">{t('homeAffairs.marriageForm.civil')}</option>
                <option value="Customary">{t('homeAffairs.marriageForm.customary')}</option>
              </select>
            </div>
            <div><label className="form-label">{t('homeAffairs.marriageForm.marriageDate')}</label><input type="date" className="form-input" value={edit.marriageDate} onChange={(e) => setEdit({ ...edit, marriageDate: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.marriageForm.placeOfMarriage')}</label><input className="form-input" value={edit.placeOfMarriage} onChange={(e) => setEdit({ ...edit, placeOfMarriage: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.marriageForm.witness1Name')}</label><input className="form-input" value={edit.witness1Name} onChange={(e) => setEdit({ ...edit, witness1Name: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.marriageForm.witness2Name')}</label><input className="form-input" value={edit.witness2Name} onChange={(e) => setEdit({ ...edit, witness2Name: e.target.value })} /></div>
            <div><label className="form-label">{t('homeAffairs.marriageForm.officiantName')}</label><input className="form-input" value={edit.officiantName} onChange={(e) => setEdit({ ...edit, officiantName: e.target.value })} /></div>
          </dl>

          <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
            <button type="button" disabled={busy} className="btn-primary" onClick={submitResubmit}>{t('common.resubmitForReview')}</button>
            <button type="button" disabled={busy} className="btn-secondary" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="card mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.marriageForm.spouseDetails')}</p>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.spouseName')}</dt><dd className="font-medium">{record.spouse2_name}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.spouseDateOfBirth')}</dt><dd className="font-medium">{record.spouse2_date_of_birth ? formatDateOnly(record.spouse2_date_of_birth) : '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.spouseNationality')}</dt><dd className="font-medium">{record.spouse2_nationality || '—'}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.spousePermanentId')}</dt><dd className="font-mono font-medium">{record.spouse2_permanent_identity_number || '—'}</dd></div>
            </dl>
          </div>

          <div className="card mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.marriageForm.title')}</p>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.marriageType')}</dt><dd className="font-medium">{t(`homeAffairs.marriageForm.${record.marriage_type.toLowerCase()}`)}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.marriageDate')}</dt><dd className="font-medium">{formatDateOnly(record.marriage_date)}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.placeOfMarriage')}</dt><dd className="font-medium">{record.place_of_marriage}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.witness1Name')}</dt><dd className="font-medium">{record.witness1_name}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.witness2Name')}</dt><dd className="font-medium">{record.witness2_name}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('homeAffairs.marriageForm.officiantName')}</dt><dd className="font-medium">{record.officiant_name || '—'}</dd></div>
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