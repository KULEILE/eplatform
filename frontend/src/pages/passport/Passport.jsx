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
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState('');

  function load() { api.get('/passport').then((d) => setRecords(d.passportRecords)); }
  useEffect(() => { load(); }, []);

  async function apply(e) {
    e.preventDefault();
    setError('');
    if (!preferredOfficeId) { setError(t('offices.chooseBranchRequired')); return; }
    if (!photoReference) { setError(t('photoCapture.required')); return; }
    try {
      await api.post('/passport/apply', { passportType, preferredOfficeId, photoReference });
      setPreferredOfficeId('');
      setPhotoReference(null);
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    }
  }

  async function transition(id, action) {
    await api.post(`/passport/${id}/${action}`, {});
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
          <p className="mb-3 text-sm text-slate-600">ℹ {t('passport.reuseNotice')}</p>
          <div className="mb-4 max-w-xs">
            <label htmlFor="passportType" className="form-label">{t('passport.type')}</label>
            <select id="passportType" className="form-input" value={passportType} onChange={(e) => setPassportType(e.target.value)}>
              <option value="Ordinary">{t('passport.ordinary')}</option>
              <option value="Diplomatic">{t('passport.diplomatic')}</option>
              <option value="Official">{t('passport.official')}</option>
            </select>
          </div>
          <PhotoCapture value={photoReference} onChange={setPhotoReference} help={t('photoCapture.idHelp')} />
          <DistrictOfficeSelect departmentKey="passport" value={preferredOfficeId} onChange={setPreferredOfficeId} />
          <button type="submit" className="btn-primary">{t('passport.apply')}</button>
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
          { key: 'passport_type', header: t('passport.type'), render: (r) => t(`passport.${r.passport_type.toLowerCase()}`) },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          { key: 'passport_number', header: t('passport.passportNumber'), render: (r) => r.passport_number ? <span className="font-mono text-xs">{r.passport_number}</span> : '—' },
          ...(isOfficer ? [{
            key: 'actions', header: t('common.actions'),
            render: (r) => {
              const next = NEXT[r.status];
              return (
                <div className="flex flex-wrap gap-2">
                  {next && <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => transition(r.passport_record_id, next.action)}>{t(next.labelKey)}</button>}
                  {!['Rejected', 'Collected'].includes(r.status) && (
                    <>
                      <button type="button" className="text-sm font-medium text-slate-500 hover:underline" onClick={() => setModal({ id: r.passport_record_id, kind: 'request-information' })}>{t('common.requestInformation')}</button>
                      <button type="button" className="text-sm font-medium text-gov-red hover:underline" onClick={() => setModal({ id: r.passport_record_id, kind: 'reject' })}>{t('common.reject')}</button>
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
    </div>
  );
}
