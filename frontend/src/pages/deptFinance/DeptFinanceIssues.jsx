import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import { formatDateOnly } from '../../utils/format';

const STATUS_KIND = { Submitted: 'warning', Resolved: 'positive' };

/**
 * The financial-issues queue for whichever department+office this administrator is currently
 * switched to (see DeptFinanceHub.jsx). When switched to Finance, this same list and these same
 * actions are how issues ESCALATED from every other department get resolved — one role on both
 * ends of the escalation (migration 078), not a separate finance_officer queue.
 */
export default function DeptFinanceIssues() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('Submitted');
  const [busyId, setBusyId] = useState(null);
  const [modal, setModal] = useState(null); // { kind: 'resolve' | 'escalate', issue }
  const [note, setNote] = useState('');

  const isFinanceContext = user.activeDepartmentKey === 'finance';

  function load(status) {
    api.get(`/financial-issues${status ? `?status=${status}` : ''}`)
      .then((d) => setRows(d.financialIssues))
      .catch((err) => setError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { setRows(null); load(statusFilter); }, [statusFilter]);

  async function runAction(issue, action) {
    setBusyId(issue.financial_issue_id);
    setError('');
    try {
      const body = action === 'resolve' ? { resolutionNotes: note.trim() } : { escalationNote: note.trim() || undefined };
      await api.post(`/financial-issues/${issue.financial_issue_id}/${action}`, body);
      setModal(null); setNote('');
      load(statusFilter);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusyId(null);
    }
  }

  if (!user.activeOfficeId) {
    return (
      <EmptyState icon="🏢" title={t('deptFinance.noContextTitle')} message={t('deptFinance.noContextMessage')}
        action={<Link to="/department-finance" className="btn-primary">{t('deptFinance.chooseContext')}</Link>} />
    );
  }
  if (!rows) return <Loading />;

  return (
    <div>
      <Link to="/department-finance" className="mb-4 inline-block text-sm font-medium text-gov-navy hover:underline">← {t('deptFinance.title')}</Link>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('deptFinance.issuesTitle')}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {t('deptFinance.issuesContext', { department: t(`departments.${user.activeDepartmentKey}`), office: user.activeOfficeName })}
      </p>

      <div className="mb-4 flex overflow-hidden rounded-md border border-slate-300 text-sm w-fit">
        {['Submitted', 'Resolved', ''].map((s) => (
          <button key={s || 'all'} type="button" onClick={() => setStatusFilter(s)} className={`px-3 py-2 ${statusFilter === s ? 'bg-gov-navy text-white' : 'bg-white'}`}>
            {s ? t(`status.${s}`) : t('police.amendments.allStatuses')}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <DataTable
        rowKey="financial_issue_id"
        rows={rows}
        emptyTitle={t('deptFinance.noIssues')}
        columns={[
          { key: 'reference', header: t('police.cases.caseReference'), render: (r) => <span className="font-mono text-xs">{r.reference}</span> },
          { key: 'citizen', header: t('police.clearance.field.fullName'), render: (r) => `${r.first_name} ${r.last_name}` },
          { key: 'origin', header: t('deptFinance.raisedAgainst'), render: (r) => t(`departments.${r.origin_department_key}`) },
          { key: 'subject', header: t('deptFinance.subject') },
          { key: 'created_at', header: t('deptFinance.submitted'), render: (r) => formatDateOnly(r.created_at) },
          { key: 'escalated', header: t('deptFinance.escalated'), render: (r) => r.escalated ? <StatusBadge status="Escalated" kind="warning" /> : '—' },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} kind={STATUS_KIND[r.status]} /> },
          {
            key: 'actions', header: t('common.actions'),
            render: (r) => r.status !== 'Submitted' ? (
              <span className="text-xs text-slate-500">{r.resolution_notes || '—'}</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busyId === r.financial_issue_id} className="btn-row-primary" onClick={() => { setModal({ kind: 'resolve', issue: r }); setNote(''); setError(''); }}>
                  {t('deptFinance.resolve')}
                </button>
                {!isFinanceContext && (
                  <button type="button" disabled={busyId === r.financial_issue_id} className="btn-row-danger" onClick={() => { setModal({ kind: 'escalate', issue: r }); setNote(''); setError(''); }}>
                    {t('deptFinance.escalateToFinance')}
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.kind === 'resolve' ? t('deptFinance.resolve') : t('deptFinance.escalateToFinance')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
          <button
            type="button"
            className={modal?.kind === 'escalate' ? 'btn-danger' : 'btn-primary'}
            disabled={busyId === modal?.issue?.financial_issue_id || (modal?.kind === 'resolve' && !note.trim())}
            onClick={() => runAction(modal.issue, modal.kind)}
          >
            {t('common.confirm')}
          </button>
        </>}
      >
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        {modal?.kind === 'resolve' && <p className="mb-3 text-sm text-slate-600">{modal.issue?.description}</p>}
        <label htmlFor="note" className="form-label">
          {modal?.kind === 'resolve' ? t('deptFinance.resolutionNotesLabel') : t('deptFinance.escalationNoteLabel')}
        </label>
        {modal?.kind === 'escalate' && <p className="mb-1 text-xs text-slate-500">{t('common.optional')}</p>}
        <textarea id="note" className="form-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </div>
  );
}
