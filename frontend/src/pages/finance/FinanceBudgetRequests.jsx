import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import Modal from '../../components/ui/Modal';
import { formatDateOnly } from '../../utils/format';

const STATUS_KIND = { Requested: 'info', 'Under Review': 'warning', Approved: 'positive', Rejected: 'negative', Disbursed: 'positive' };

/**
 * Finance Officer's review queue for Branch Budget Requests — "head branch administrator where
 * they apply and receive money", approved/disbursed here per the explicit answer "leave it with
 * Finance Officer" (these approvals stay with the existing finance_officer role, NOT the new
 * Department Finance Administrator role). Deliberately separate from the pre-existing Budget
 * and Tenders document library (finance_publications) — see migration 078's doc comment.
 */
export default function FinanceBudgetRequests() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [modal, setModal] = useState(null); // { action, request }
  const [note, setNote] = useState('');

  function load() {
    api.get('/branch-budget-requests').then((d) => setRows(d.budgetRequests)).catch((err) => setError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, []);

  const visibleRows = rows && (statusFilter ? rows.filter((r) => r.status === statusFilter) : rows);

  async function runAction(request, action) {
    setBusyId(request.budget_request_id);
    setError('');
    try {
      await api.post(`/branch-budget-requests/${request.budget_request_id}/${action}`, { reviewNote: note.trim() || undefined });
      setModal(null); setNote('');
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusyId(null);
    }
  }

  if (!rows) return <Loading />;

  const nextAction = {
    Requested: [{ action: 'review', labelKey: 'finance.budgetRequests.review' }, { action: 'approve', labelKey: 'finance.budgetRequests.approve' }, { action: 'reject', labelKey: 'finance.budgetRequests.reject' }],
    'Under Review': [{ action: 'approve', labelKey: 'finance.budgetRequests.approve' }, { action: 'reject', labelKey: 'finance.budgetRequests.reject' }],
    Approved: [{ action: 'disburse', labelKey: 'finance.budgetRequests.disburse' }],
  };

  return (
    <div>
      <Link to="/finance" className="mb-4 inline-block text-sm font-medium text-gov-navy hover:underline">← {t('departments.finance')}</Link>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('finance.budgetRequests.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('finance.budgetRequests.intro')}</p>

      <div className="mb-4 flex overflow-hidden rounded-md border border-slate-300 text-sm w-fit">
        {['', 'Requested', 'Under Review', 'Approved', 'Rejected', 'Disbursed'].map((s) => (
          <button key={s || 'all'} type="button" onClick={() => setStatusFilter(s)} className={`px-3 py-2 ${statusFilter === s ? 'bg-gov-navy text-white' : 'bg-white'}`}>
            {s ? t(`status.${s}`) : t('police.amendments.allStatuses')}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <DataTable
        rowKey="budget_request_id"
        rows={visibleRows}
        emptyTitle={t('finance.budgetRequests.noRequests')}
        columns={[
          { key: 'reference', header: t('police.cases.caseReference'), render: (r) => <span className="font-mono text-xs">{r.reference}</span> },
          { key: 'office', header: t('offices.branch'), render: (r) => `${r.office_name} (${t(`departments.${r.department_key}`)})` },
          { key: 'amount', header: t('finance.budgetRequests.amount'), render: (r) => `M ${Number(r.amount).toLocaleString()}` },
          { key: 'purpose', header: t('finance.budgetRequests.purpose') },
          { key: 'fiscal_year', header: t('finance.budgetRequests.fiscalYear') },
          { key: 'requested_by', header: t('police.amendments.requestedBy'), render: (r) => r.requested_by_email || '—' },
          { key: 'created_at', header: t('deptFinance.submitted'), render: (r) => formatDateOnly(r.created_at) },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} kind={STATUS_KIND[r.status]} /> },
          {
            key: 'actions', header: t('common.actions'),
            render: (r) => (nextAction[r.status] || []).length === 0 ? (
              <span className="text-xs text-slate-500">{r.review_note || '—'}</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {nextAction[r.status].map(({ action, labelKey }) => (
                  <button
                    key={action}
                    type="button"
                    disabled={busyId === r.budget_request_id}
                    className={action === 'reject' ? 'btn-row-danger' : 'btn-row-primary'}
                    onClick={() => { setModal({ action, request: r }); setNote(''); setError(''); }}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal ? t(`finance.budgetRequests.${modal.action}`) : ''}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
          <button
            type="button"
            className={modal?.action === 'reject' ? 'btn-danger' : 'btn-primary'}
            disabled={busyId === modal?.request?.budget_request_id || (modal?.action === 'reject' && !note.trim())}
            onClick={() => runAction(modal.request, modal.action)}
          >
            {t('common.confirm')}
          </button>
        </>}
      >
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        {modal?.action !== 'disburse' && (
          <>
            <label htmlFor="note" className="form-label">{t('police.amendments.reviewNoteLabel')}</label>
            <p className="mb-1 text-xs text-slate-500">{modal?.action === 'reject' ? t('police.amendments.reviewNoteRequiredHelp') : t('common.optional')}</p>
            <textarea id="note" className="form-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        )}
        {modal?.action === 'disburse' && <p className="text-sm text-slate-600">{t('finance.budgetRequests.disburseConfirm')}</p>}
      </Modal>
    </div>
  );
}
