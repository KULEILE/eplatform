import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserGroupIcon, EyeIcon, EyeSlashIcon, HeartIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import Modal from '../../components/ui/Modal';
import FormField from '../../components/ui/FormField';

function maskAccountNumber(number) {
  if (!number) return '';
  const digits = String(number);
  if (digits.length <= 4) return digits;
  return '•'.repeat(digits.length - 4) + digits.slice(-4);
}

/**
 * Employee roster and payroll — "it must show all employee and those who are still alive and
 * those who are dead and finance department should pay this employee." See
 * finance.controller.js's listEmployees doc comment for why this is deliberately a browsable
 * directory (unlike the single-lookup government-employment panel above it). An account with no
 * linked citizen identity shows up here too, flagged "Not linked" rather than hidden — a system
 * administrator fixes that from Manage Employees (admin.controller.js's linkEmployeeCitizen).
 */
export default function EmployeeRoster() {
  const { t } = useLanguage();
  const [employees, setEmployees] = useState(null);
  const [error, setError] = useState('');
  const [salaryTarget, setSalaryTarget] = useState(null); // employee row
  const [salaryInput, setSalaryInput] = useState('');
  const [payTarget, setPayTarget] = useState(null);
  const [payPeriod, setPayPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [payReference, setPayReference] = useState('');
  const [historyTarget, setHistoryTarget] = useState(null);
  const [history, setHistory] = useState(null);
  const [revealed, setRevealed] = useState({}); // citizenId -> bool
  const [busy, setBusy] = useState(false);

  function load() { api.get('/finance/employees').then((d) => setEmployees(d.employees)).catch((err) => setError(err.message)); }
  useEffect(() => { load(); }, []);

  async function saveSalary() {
    setBusy(true);
    try {
      await api.patch(`/finance/employees/${salaryTarget.citizen_id}/salary`, { monthlySalary: Number(salaryInput) });
      setSalaryTarget(null); setSalaryInput('');
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
      await api.post(`/finance/employees/${payTarget.citizen_id}/pay`, { payPeriod, reference: payReference || undefined });
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
    api.get(`/finance/employees/${row.citizen_id}/payments`).then((d) => setHistory(d.payments));
  }

  if (!employees) return <Loading />;

  return (
    <div>
      <p className="mb-4 text-sm">
        <Link to="/finance" className="font-medium text-gov-navy hover:underline">&larr; {t('finance.title')}</Link>
      </p>
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold text-slate-900">
        <UserGroupIcon className="h-6 w-6 text-gov-navy" strokeWidth={1.6} /> {t('finance.employees.title')}
      </h1>
      <p className="mb-6 text-sm text-slate-500">{t('finance.employees.intro')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <DataTable
        rowKey="user_id"
        rows={employees}
        columns={[
          { key: 'username', header: t('auth.username') },
          { key: 'role', header: t('admin.role'), render: (r) => r.role_name },
          {
            key: 'name', header: t('common.citizen'),
            render: (r) => r.citizen_id ? `${r.first_name} ${r.last_name}` : <span className="text-xs italic text-slate-400">{t('finance.employees.notLinked')}</span>,
          },
          {
            key: 'alive', header: t('finance.employees.lifeStatus'),
            render: (r) => !r.citizen_id ? '—' : r.is_deceased
              ? <span className="inline-flex items-center gap-1 text-xs font-medium text-gov-red"><HeartIcon className="h-3.5 w-3.5" /> {t('finance.employees.deceased')}</span>
              : <span className="inline-flex items-center gap-1 text-xs font-medium text-gov-green"><HeartIcon className="h-3.5 w-3.5" /> {t('finance.employees.alive')}</span>,
          },
          {
            key: 'employmentStatus', header: t('finance.employment.statusLabel'),
            render: (r) => r.citizen_id ? t(`finance.employmentStatus.${r.government_employment_status}`) : '—',
          },
          {
            key: 'salary', header: t('finance.employees.salary'),
            render: (r) => r.monthly_salary ? `M ${Number(r.monthly_salary).toFixed(2)}` : '—',
          },
          {
            key: 'bank', header: t('finance.bankDetails.field.bankAccountNumber'),
            render: (r) => r.bank_account_number ? (
              <span className="flex items-center gap-1 font-mono text-xs">
                {revealed[r.citizen_id] ? r.bank_account_number : maskAccountNumber(r.bank_account_number)}
                <button type="button" onClick={() => setRevealed((v) => ({ ...v, [r.citizen_id]: !v[r.citizen_id] }))}>
                  {revealed[r.citizen_id] ? <EyeSlashIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
                </button>
              </span>
            ) : '—',
          },
          {
            key: 'actions', header: t('common.actions'),
            render: (r) => r.citizen_id && r.government_employment_status === 'Active' && !r.is_deceased ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" className="btn-row-secondary" onClick={() => { setSalaryTarget(r); setSalaryInput(r.monthly_salary || ''); }}>{t('finance.employees.setSalary')}</button>
                <button type="button" className="btn-row-primary" disabled={!r.monthly_salary} onClick={() => setPayTarget(r)}>{t('finance.employees.pay')}</button>
                <button type="button" className="text-xs font-medium text-gov-navy hover:underline" onClick={() => openHistory(r)}>{t('finance.employees.history')}</button>
              </div>
            ) : r.citizen_id ? (
              <button type="button" className="text-xs font-medium text-gov-navy hover:underline" onClick={() => openHistory(r)}>{t('finance.employees.history')}</button>
            ) : (
              <span className="text-xs text-slate-400">{t('finance.employees.linkHelp')}</span>
            ),
          },
        ]}
      />

      <Modal open={!!salaryTarget} onClose={() => setSalaryTarget(null)} title={t('finance.employees.setSalary')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setSalaryTarget(null)}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" disabled={busy || !salaryInput} onClick={saveSalary}>{t('common.confirm')}</button>
        </>}>
        <FormField label={t('finance.employees.salary')} htmlFor="salaryInput">
          <input id="salaryInput" type="number" min="0" step="0.01" className="form-input" value={salaryInput} onChange={(e) => setSalaryInput(e.target.value)} />
        </FormField>
      </Modal>

      <Modal open={!!payTarget} onClose={() => setPayTarget(null)} title={t('finance.employees.pay')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setPayTarget(null)}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" disabled={busy || !payPeriod} onClick={recordPayment}>{t('common.confirm')}</button>
        </>}>
        <p className="mb-3 text-sm text-slate-600">{t('finance.employees.payConfirm', { amount: payTarget ? Number(payTarget.monthly_salary).toFixed(2) : '' })}</p>
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
              <li key={p.salary_payment_id} className="flex justify-between border-b border-slate-100 pb-1">
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
