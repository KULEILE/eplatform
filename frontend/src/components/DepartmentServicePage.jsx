import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from './ui/Loading';
import DataTable from './ui/DataTable';
import StatusBadge from './ui/StatusBadge';
import Modal from './ui/Modal';

/**
 * Shared UI for the three "breadth" departments (Traffic, Finance, Pensions) whose backend
 * uses the generic simpleDepartmentController factory. Citizens apply and track; officers work
 * a queue with the department's configured status transitions.
 *
 * config: { apiBase, titleKey, serviceTypes: string[], serviceTypeNs, officerRoleKey,
 *           transitions: { [status]: { action, labelKey } } }
 */
export default function DepartmentServicePage({ config }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = user.roleKey === config.officerRoleKey || user.roleKey === 'system_administrator';
  const [records, setRecords] = useState(null);
  const [serviceType, setServiceType] = useState(config.serviceTypes[0]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { id, kind: 'reject' | 'request-information' }
  const [reason, setReason] = useState('');

  function load() { api.get(`${config.apiBase}/`).then((d) => setRecords(d.records)); }
  useEffect(() => { load(); }, []);

  async function apply(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`${config.apiBase}/apply`, { serviceType });
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    }
  }

  async function transition(record, action) {
    setBusyId(record.recordId || record[Object.keys(record).find((k) => k.endsWith('_id'))]);
    try {
      const idField = Object.keys(record).find((k) => k.endsWith('_record_id'));
      await api.post(`${config.apiBase}/${record[idField]}/${action}`, {});
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function submitModal() {
    const idField = Object.keys(modal.record).find((k) => k.endsWith('_record_id'));
    await api.post(`${config.apiBase}/${modal.record[idField]}/${modal.kind}`, { reason });
    setModal(null);
    setReason('');
    load();
  }

  if (!records) return <Loading />;

  const idFieldFor = (r) => r[Object.keys(r).find((k) => k.endsWith('_record_id'))];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t(config.titleKey)}</h1>

      {!isOfficer && (
        <form onSubmit={apply} className="card mb-8 flex flex-wrap items-end gap-3">
          {error && <p className="w-full rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
          <div className="flex-1">
            <label htmlFor="serviceType" className="form-label">{t(`${config.serviceTypeNs}.serviceType`)}</label>
            <select id="serviceType" className="form-input" value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
              {config.serviceTypes.map((s) => <option key={s} value={s}>{t(`${config.serviceTypeNs}.${s}`)}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-primary">{t(`${config.serviceTypeNs}.apply`)}</button>
        </form>
      )}

      <DataTable
        rowKey={idFieldFor(records[0] || {}) !== undefined ? Object.keys(records[0] || {}).find((k) => k.endsWith('_record_id')) : 'id'}
        rows={records}
        columns={[
          { key: 'application_reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.application_reference}</span> },
          ...(isOfficer ? [{ key: 'name', header: 'Citizen', render: (r) => `${r.first_name} ${r.last_name}` }] : []),
          { key: 'service_type', header: t(`${config.serviceTypeNs}.serviceType`), render: (r) => t(`${config.serviceTypeNs}.${r.service_type}`) },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          ...(isOfficer ? [{
            key: 'actions', header: t('common.actions'),
            render: (r) => {
              const rawNext = config.transitions[r.status];
              const nextOptions = rawNext ? (Array.isArray(rawNext) ? rawNext : [rawNext]) : [];
              const busy = busyId === idFieldFor(r);
              return (
                <div className="flex flex-wrap gap-2">
                  {nextOptions.map((opt) => (
                    <button key={opt.action} type="button" disabled={busy} className="text-sm font-medium text-gov-navy hover:underline" onClick={() => transition(r, opt.action)}>
                      {t(opt.labelKey)}
                    </button>
                  ))}
                  {!['Rejected', 'Completed', 'Collected'].includes(r.status) && (
                    <>
                      <button type="button" className="text-sm font-medium text-slate-500 hover:underline" onClick={() => setModal({ record: r, kind: 'request-information' })}>{t('common.requestInformation')}</button>
                      <button type="button" className="text-sm font-medium text-gov-red hover:underline" onClick={() => setModal({ record: r, kind: 'reject' })}>{t('common.reject')}</button>
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
        <label htmlFor="modalReason" className="form-label">{t('common.reason')}</label>
        <textarea id="modalReason" className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}
