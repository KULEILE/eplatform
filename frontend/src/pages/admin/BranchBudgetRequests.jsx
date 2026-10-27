import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import FormField from '../../components/ui/FormField';
import { formatDateOnly } from '../../utils/format';

const STATUS_KIND = { Requested: 'info', 'Under Review': 'warning', Approved: 'positive', Rejected: 'negative', Disbursed: 'positive' };

/**
 * Branch Administrator applies for and receives budget money for its own branch office — "head
 * branch administrator where they apply and receive money" (migration 078). Approval stays with
 * the existing Finance Officer role (see FinanceBudgetRequests.jsx) — this page only lets the
 * branch admin submit a request and track its status. Kept separate from the unrelated Budget
 * and Tenders document library.
 */
export default function BranchBudgetRequests() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState({ amount: '', purpose: '', justification: '', fiscalYear: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() { api.get('/branch-budget-requests').then((d) => setRows(d.budgetRequests)); }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/branch-budget-requests', form);
      setForm({ amount: '', purpose: '', justification: '', fiscalYear: '' });
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('finance.budgetRequests.branchTitle')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('finance.budgetRequests.branchIntro', { office: user.officeName || '' })}</p>

      <form onSubmit={submit} className="card mb-8">
        <h2 className="mb-4 font-semibold text-slate-800">{t('finance.budgetRequests.newRequest')}</h2>
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('finance.budgetRequests.amount')} htmlFor="amount" required>
            <input id="amount" type="number" min="1" step="0.01" required className="form-input" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </FormField>
          <FormField label={t('finance.budgetRequests.fiscalYear')} htmlFor="fiscalYear" required help={t('finance.budgetRequests.fiscalYearHelp')}>
            <input id="fiscalYear" required placeholder="2026/2027" maxLength={9} className="form-input" value={form.fiscalYear} onChange={(e) => setForm((f) => ({ ...f, fiscalYear: e.target.value }))} />
          </FormField>
        </div>
        <FormField label={t('finance.budgetRequests.purpose')} htmlFor="purpose" required>
          <input id="purpose" required maxLength={200} className="form-input" value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} />
        </FormField>
        <FormField label={t('finance.budgetRequests.justification')} htmlFor="justification" help={t('common.optional')}>
          <textarea id="justification" rows={3} className="form-input" value={form.justification} onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))} />
        </FormField>
        <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('finance.budgetRequests.submit')}</button>
      </form>

      {rows && (
        <DataTable
          rowKey="budget_request_id"
          rows={rows}
          emptyTitle={t('finance.budgetRequests.noRequests')}
          columns={[
            { key: 'reference', header: t('police.cases.caseReference'), render: (r) => <span className="font-mono text-xs">{r.reference}</span> },
            { key: 'amount', header: t('finance.budgetRequests.amount'), render: (r) => `M ${Number(r.amount).toLocaleString()}` },
            { key: 'purpose', header: t('finance.budgetRequests.purpose') },
            { key: 'fiscal_year', header: t('finance.budgetRequests.fiscalYear') },
            { key: 'created_at', header: t('deptFinance.submitted'), render: (r) => formatDateOnly(r.created_at) },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} kind={STATUS_KIND[r.status]} /> },
            { key: 'review_note', header: t('police.amendments.reviewNoteLabel'), render: (r) => r.review_note || '—' },
          ]}
        />
      )}
    </div>
  );
}
