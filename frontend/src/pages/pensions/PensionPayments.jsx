import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BanknotesIcon, UsersIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import Modal from '../../components/ui/Modal';
import FormField from '../../components/ui/FormField';

/**
 * Pension disbursement and totals — "pension department should pay eligible citizens and it
 * must show totals of citizen how earning pensions." See pensions.controller.js's
 * listPensioners doc comment: an eligible pensioner is a citizen with an approved
 * ('Completed') Pension Age Eligibility Claim or Civil Service Pension Claim — a pension
 * stopped for a deceased citizen naturally drops off this list the moment that happens.
 */
export default function PensionPayments() {
  const { t } = useLanguage();
  const [data, setData] = useState(null); // { pensioners, totals }
  const [error, setError] = useState('');
  const [amountTarget, setAmountTarget] = useState(null);
  const [amountInput, setAmountInput] = useState('');
  const [payTarget, setPayTarget] = useState(null);
  const [payPeriod, setPayPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [payReference, setPayReference] = useState('');
  const [historyTarget, setHistoryTarget] = useState(null);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);

  function load() { api.get('/pensions/pensioners').then(setData).catch((err) => setError(err.message)); }
  useEffect(() => { load(); }, []);

  async function saveAmount() {
    setBusy(true);
    try {
      await api.patch(`/pensions/pensioners/${amountTarget.pension_record_id}/amount`, { monthlyAmount: Number(amountInput) });
      setAmountTarget(null); setAmountInput('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment() {
    setBusy(true);
    try {
      await api.post(`/pensions/pensioners/${payTarget.pension_record_id}/pay`, { payPeriod, reference: payReference || undefined });
      setPayTarget(null); setPayReference('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openHistory(row) {
    setHistoryTarget(row);
    setHistory(null);
    api.get(`/pensions/pensioners/${row.pension_record_id}/payments`).then((d) => setHistory(d.payments));
  }

  if (!data) return <Loading />;

  return (
    <div>
      <p className="mb-4 text-sm">
        <Link to="/pensions" className="font-medium text-gov-navy hover:underline">&larr; {t('pensions.title')}</Link>
      </p>
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold text-slate-900">
        <BanknotesIcon className="h-6 w-6 text-gov-navy" strokeWidth={1.6} /> {t('pensions.payments.title')}
      </h1>
      <p className="mb-6 text-sm text-slate-500">{t('pensions.payments.intro')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy"><UsersIcon className="h-5 w-5" strokeWidth={1.75} /></span>
          <span>
            <span className="block text-xs text-slate-500">{t('pensions.payments.totalPensioners')}</span>
            <span className="block text-xl font-bold text-slate-900">{data.totals.pensionerCount}</span>
          </span>
        </div>
        <div className="card flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy"><BanknotesIcon className="h-5 w-5" strokeWidth={1.75} /></span>
          <span>
            <span className="block text-xs text-slate-500">{t('pensions.payments.totalPaid')}</span>
            <span className="block text-xl font-bold text-slate-900">M {Number(data.totals.totalPaid).toFixed(2)}</span>
          </span>
        </div>
      </div>

      <DataTable
        rowKey="pension_record_id"
        rows={data.pensioners}
        columns={[
          { key: 'name', header: t('common.citizen'), render: (r) => `${r.first_name} ${r.last_name}` },
          { key: 'pin', header: t('auth.permanentIdentityNumber'), render: (r) => <span className="font-mono text-xs">{r.permanent_identity_number}</span> },
          { key: 'service_type', header: t('pensions.serviceType'), render: (r) => t(`pensions.${r.service_type}`) },
          { key: 'amount', header: t('pensions.payments.monthlyAmount'), render: (r) => r.monthly_amount ? `M ${Number(r.monthly_amount).toFixed(2)}` : '—' },
          {
            key: 'actions', header: t('common.actions'),
            render: (r) => (
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" className="btn-row-secondary" onClick={() => { setAmountTarget(r); setAmountInput(r.monthly_amount || ''); }}>{t('pensions.payments.setAmount')}</button>
                <button type="button" className="btn-row-primary" disabled={!r.monthly_amount} onClick={() => setPayTarget(r)}>{t('pensions.payments.pay')}</button>
                <button type="button" className="text-xs font-medium text-gov-navy hover:underline" onClick={() => openHistory(r)}>{t('finance.employees.history')}</button>
              </div>
            ),
          },
        ]}
      />

      <Modal open={!!amountTarget} onClose={() => setAmountTarget(null)} title={t('pensions.payments.setAmount')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setAmountTarget(null)}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" disabled={busy || !amountInput} onClick={saveAmount}>{t('common.confirm')}</button>
        </>}>
        <FormField label={t('pensions.payments.monthlyAmount')} htmlFor="amountInput">
          <input id="amountInput" type="number" min="0" step="0.01" className="form-input" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} />
        </FormField>
      </Modal>

      <Modal open={!!payTarget} onClose={() => setPayTarget(null)} title={t('pensions.payments.pay')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setPayTarget(null)}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" disabled={busy || !payPeriod} onClick={recordPayment}>{t('common.confirm')}</button>
        </>}>
        <p className="mb-3 text-sm text-slate-600">{t('finance.employees.payConfirm', { amount: payTarget ? Number(payTarget.monthly_amount).toFixed(2) : '' })}</p>
        <FormField label={t('finance.employees.payPeriod')} htmlFor="payPeriod">
          <input id="payPeriod" type="month" className="form-input" value={payPeriod} onChange={(e) => setPayPeriod(e.target.value)} />
        </FormField>
        <FormField label={t('finance.employees.payReference')} htmlFor="payReference" help={t('common.optional')}>
          <input id="payReference" className="form-input" value={payReference} onChange={(e) => setPayReference(e.target.value)} />
        </FormField>
      </Modal>

      <Modal open={!!historyTarget} onClose={() => setHistoryTarget(null)} title={t('finance.employees.history')}
        footer={<button type="button" className="btn-secondary" onClick={() => setHistoryTarget(null)}>{t('common.close')}</button>}>
        {!history ? <Loading /> : history.length === 0 ? (
          <p className="text-sm text-slate-500">{t('finance.employees.noPayments')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {history.map((p) => (
              <li key={p.pension_payment_id} className="flex justify-between border-b border-slate-100 pb-1">
                <span>{p.pay_period}</span>
                <span className="font-medium">M {Number(p.amount).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
