import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const RETIREMENT_REASONS = ['Standard', 'Ill-health', 'Medical Boarding', 'Compulsory Retirement', 'Redundancy', 'Other'];
const EMPLOYEE_CATEGORIES = ['General Civil Servant', 'Uniformed/Disciplined Services'];

const retirementConfig = {
  apiBase: '/finance',
  idColumn: 'finance_record_id',
  titleKey: 'finance.retirement.title',
  serviceTypeNs: 'finance',
  officerRoleKey: 'finance_officer',
  serviceTypes: ['Government Employee Retirement Declaration'],
  extraFields: [
    {
      name: 'retirementReason', type: 'select', required: true, label: '', // label set below via t()
      options: [],
    },
  ],
  transitions: {
    'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
    'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
    'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
    'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
    'Processing': { action: 'complete', labelKey: 'status.Completed' },
  },
};

/**
 * Government employment record — Finance owns this, never the citizen (see migration 048 and
 * finance.controller.js). Officers get a narrow, one-citizen-at-a-time lookup/declare panel
 * (never a browsable directory); citizens get the retirement declaration itself, which only
 * takes effect once an officer approves it (see afterTransition in finance.controller.js).
 */
export default function GovernmentEmployment() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['finance_officer', 'system_administrator'].includes(user.roleKey);

  const config = {
    ...retirementConfig,
    extraFields: [
      {
        name: 'retirementReason', type: 'select', required: true,
        label: t('finance.retirement.reasonLabel'),
        options: RETIREMENT_REASONS.map((r) => ({ value: r, label: t(`finance.retirementReason.${r}`) })),
      },
      {
        name: 'retirementReasonDetails', type: 'textarea', required: false,
        label: t('finance.retirement.detailsLabel'), help: t('finance.retirement.detailsHelp'),
      },
      {
        name: 'retirementDocumentReference', type: 'photo', required: true,
        label: t('finance.retirement.documentLabel'), help: t('finance.retirement.documentHelp'),
      },
    ],
  };

  return (
    <div>
      <p className="mb-4 text-sm">
        <Link to="/finance" className="font-medium text-gov-navy hover:underline">&larr; {t('finance.title')}</Link>
      </p>

      {isOfficer && <EmploymentOfficerPanel t={t} />}

      <DepartmentServicePage config={config} />

      <p className="mt-6 text-sm text-slate-600">
        {t('finance.retirement.mistakeNotice')} <Link to="/finance/corrections" className="font-medium text-gov-navy hover:underline">{t('finance.correction')}</Link>
      </p>
    </div>
  );
}

function EmploymentOfficerPanel({ t }) {
  const [pin, setPin] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [category, setCategory] = useState(EMPLOYEE_CATEGORIES[0]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function lookup(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setLookupResult(null);
    if (!pin.trim()) return;
    setBusy(true);
    try {
      const { citizen } = await api.get(`/finance/government-employment/${encodeURIComponent(pin.trim())}`);
      setLookupResult(citizen);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function declare() {
    setError(''); setSuccess('');
    setBusy(true);
    try {
      await api.post('/finance/government-employment/declare', { permanentIdentityNumber: pin.trim(), employeeCategory: category });
      setSuccess(t('finance.employment.declared'));
      lookup({ preventDefault: () => {} });
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-8">
      <h2 className="mb-4 font-semibold text-slate-800">{t('finance.employment.panelTitle')}</h2>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      <form onSubmit={lookup} className="mb-4 flex flex-wrap items-end gap-3">
        <div className="max-w-xs flex-1">
          <FormField label={t('finance.employment.lookupLabel')} htmlFor="pin">
            <input id="pin" className="form-input" value={pin} onChange={(e) => setPin(e.target.value)} placeholder={t('auth.permanentIdentityNumber')} />
          </FormField>
        </div>
        <button type="submit" disabled={busy || !pin.trim()} className="btn-secondary mb-4">{t('common.search')}</button>
      </form>

      {lookupResult && (
        <div className="mb-4 rounded-md bg-slate-50 p-4 text-sm">
          <p className="font-medium text-slate-800">{lookupResult.first_name} {lookupResult.last_name}</p>
          <p className="mt-1 text-slate-600">
            {t('finance.employment.statusLabel')}: <span className="font-medium">{t(`finance.employmentStatus.${lookupResult.government_employment_status}`)}</span>
            {lookupResult.employee_category && <> · {t(`finance.employeeCategory.${lookupResult.employee_category}`)}</>}
            {lookupResult.retirement_reason && <> · {t('finance.retirement.reasonLabel')}: {t(`finance.retirementReason.${lookupResult.retirement_reason}`)}</>}
          </p>

          {lookupResult.government_employment_status !== 'Active' && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="max-w-xs flex-1">
                <FormField label={t('finance.employment.categoryLabel')} htmlFor="category">
                  <select id="category" className="form-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                    {EMPLOYEE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`finance.employeeCategory.${c}`)}</option>)}
                  </select>
                </FormField>
              </div>
              <button type="button" disabled={busy} onClick={declare} className="btn-primary mb-4">{t('finance.employment.declareAction')}</button>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-slate-500">{t('finance.employment.panelHelp')}</p>
    </div>
  );
}
