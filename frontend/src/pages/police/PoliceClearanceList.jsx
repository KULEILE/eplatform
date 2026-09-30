import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import Modal from '../../components/ui/Modal';

const NEXT_ACTION = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'begin-background-check', labelKey: 'status.Background Check In Progress' },
};

export default function PoliceClearanceList() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [modal, setModal] = useState(null); // { kind: 'approve'|'reject'|'request-information', record }
  const [reason, setReason] = useState('');
  const [clearanceResult, setClearanceResult] = useState('Clean Record');
  const [officerNotes, setOfficerNotes] = useState('');
  const isOfficer = ['police_officer', 'system_administrator'].includes(user.roleKey);

  function load() {
    api.get('/police/clearance').then((d) => setRows(d.records)).catch((err) => setError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, []);

  async function runAction(id, action, body = {}) {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/police/clearance/${id}/${action}`, body);
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusyId(null);
      setModal(null);
      setReason('');
      setClearanceResult('Clean Record');
      setOfficerNotes('');
    }
  }

  if (!rows) return <Loading />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('police.clearance.title')}</h1>
        {!isOfficer && <Link to="/police/clearance/apply" className="btn-primary">{t('police.clearance.applyTitle')}</Link>}
      </div>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <DataTable
        rowKey="clearance_record_id"
        rows={rows}
        emptyTitle={t('common.noResults')}
        columns={[
          { key: 'application_reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.application_reference}</span> },
          ...(isOfficer ? [{ key: 'citizen', header: t('appointments.citizen'), render: (r) => `${r.first_name} ${r.last_name}` }] : []),
          { key: 'purpose', header: t('police.clearance.purpose'), render: (r) => t(`police.clearance.purposeOption.${r.purpose}`) },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          {
            key: 'actions', header: t('common.actions'),
            render: (r) => {
              const busy = busyId === r.clearance_record_id;
              if (['Approved', 'Ready for Collection', 'Collected'].includes(r.status)) {
                return <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => navigate(`/police/clearance/${r.clearance_record_id}/certificate`)}>{t('police.clearance.viewCertificate')}</button>;
              }
              if (!isOfficer) return <span className="text-sm text-slate-400">—</span>;
              const next = NEXT_ACTION[r.status];
              return (
                <div className="flex flex-wrap gap-2">
                  {next && (
                    <button type="button" disabled={busy} className="text-sm font-medium text-gov-navy hover:underline" onClick={() => runAction(r.clearance_record_id, next.action)}>{t(next.labelKey)}</button>
                  )}
                  {r.status === 'Background Check In Progress' && (
                    <button type="button" disabled={busy} className="text-sm font-medium text-gov-green hover:underline" onClick={() => setModal({ kind: 'approve', record: r })}>{t('police.clearance.recordOutcome')}</button>
                  )}
                  {!['Rejected'].includes(r.status) && (
                    <>
                      <button type="button" disabled={busy} className="text-sm font-medium text-slate-500 hover:underline" onClick={() => setModal({ kind: 'request-information', record: r })}>{t('common.requestInformation')}</button>
                      <button type="button" disabled={busy} className="text-sm font-medium text-gov-red hover:underline" onClick={() => setModal({ kind: 'reject', record: r })}>{t('common.reject')}</button>
                    </>
                  )}
                </div>
              );
            },
          },
        ]}
      />

      <Modal
        open={modal?.kind === 'approve'}
        onClose={() => setModal(null)}
        title={t('police.clearance.recordOutcome')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn-primary" onClick={() => runAction(modal.record.clearance_record_id, 'approve', { clearanceResult, officerNotes })}>{t('common.confirm')}</button>
          </>
        }
      >
        <label className="form-label">{t('police.clearance.clearanceResult')}</label>
        <div className="mb-3 flex gap-4 text-sm">
          <label className="flex items-center gap-1.5"><input type="radio" checked={clearanceResult === 'Clean Record'} onChange={() => setClearanceResult('Clean Record')} /> {t('police.clearance.cleanRecord')}</label>
          <label className="flex items-center gap-1.5"><input type="radio" checked={clearanceResult === 'Record Found'} onChange={() => setClearanceResult('Record Found')} /> {t('police.clearance.recordFound')}</label>
        </div>
        <label htmlFor="officerNotes" className="form-label">{t('police.clearance.officerNotes')}</label>
        <textarea id="officerNotes" className="form-input" rows={3} value={officerNotes} onChange={(e) => setOfficerNotes(e.target.value)} />
      </Modal>

      <Modal
        open={modal?.kind === 'reject' || modal?.kind === 'request-information'}
        onClose={() => setModal(null)}
        title={modal?.kind === 'reject' ? t('common.reject') : t('common.requestInformation')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
            <button
              type="button"
              className={modal?.kind === 'reject' ? 'btn-danger' : 'btn-primary'}
              disabled={!reason.trim()}
              onClick={() => runAction(modal.record.clearance_record_id, modal.kind, { reason })}
            >
              {t('common.confirm')}
            </button>
          </>
        }
      >
        <label htmlFor="modalReason" className="form-label">{t('common.reason')}</label>
        <textarea id="modalReason" className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}
