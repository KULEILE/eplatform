import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BanknotesIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import DepartmentServicePage from '../../components/DepartmentServicePage';

function maskAccountNumber(number) {
  if (!number) return '';
  const digits = String(number);
  if (digits.length <= 4) return digits;
  return '•'.repeat(digits.length - 4) + digits.slice(-4);
}

const config = {
  apiBase: '/finance',
  idColumn: 'finance_record_id',
  titleKey: 'finance.bankDetails.title',
  serviceTypeNs: 'finance',
  officerRoleKey: 'finance_officer',
  serviceTypes: ['Payment Information Update'],
  extraFields: [
    { name: 'bankName', type: 'text', required: true, label: '' },
    { name: 'bankAccountHolderName', type: 'text', required: true, label: '' },
    { name: 'bankAccountNumber', type: 'text', required: true, label: '' },
    { name: 'bankBranchName', type: 'text', required: true, label: '' },
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
 * Bank details — split out of the generic multi-type Finance.jsx form (same reasoning as
 * GovernmentEmployment.jsx splitting retirement declarations out: this service needs its own
 * officer-reviewed structured fields and its own "what's on file right now" display, which
 * don't make sense alongside Financial Records Correction's plain form).
 *
 * "the citizen must be able to provide their bank details and correct them later if thy change
 * banks": submitting a NEW Payment Information Update application is how they change banks —
 * there's no separate unreviewed edit box, consistent with every other official record change
 * in this system going through an officer's review (see finance.controller.js's afterTransition,
 * which only copies the submitted bank fields onto the citizen's actual record once an officer
 * approves it).
 */
export default function BankDetails() {
  const { t } = useLanguage();
  const [onFile, setOnFile] = useState(null);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    api.get('/citizen/profile').then((d) => { if (!d.provisional) setOnFile(d.citizen); }).catch(() => {});
  }, []);

  const fields = config.extraFields.map((f) => ({ ...f, label: t(`finance.bankDetails.field.${f.name}`) }));

  return (
    <div>
      <p className="mb-4 text-sm">
        <Link to="/finance" className="font-medium text-gov-navy hover:underline">&larr; {t('finance.title')}</Link>
      </p>

      <div className="card mb-8">
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
          <BanknotesIcon className="h-5 w-5 text-gov-navy" strokeWidth={1.6} /> {t('finance.bankDetails.onFileTitle')}
        </h2>
        {onFile?.bank_account_number ? (
          <div className="text-sm text-slate-700">
            <p><span className="text-slate-500">{t('finance.bankDetails.field.bankName')}:</span> <span className="font-medium">{onFile.bank_name}</span></p>
            <p><span className="text-slate-500">{t('finance.bankDetails.field.bankAccountHolderName')}:</span> <span className="font-medium">{onFile.bank_account_holder_name}</span></p>
            <p className="flex items-center gap-2">
              <span className="text-slate-500">{t('finance.bankDetails.field.bankAccountNumber')}:</span>
              <span className="font-mono font-medium">{reveal ? onFile.bank_account_number : maskAccountNumber(onFile.bank_account_number)}</span>
              <button type="button" className="text-gov-navy" onClick={() => setReveal((r) => !r)} aria-label={t('common.show')}>
                {reveal ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </button>
            </p>
            <p><span className="text-slate-500">{t('finance.bankDetails.field.bankBranchName')}:</span> <span className="font-medium">{onFile.bank_branch_name}</span></p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">{t('finance.bankDetails.noneOnFile')}</p>
        )}
      </div>

      <DepartmentServicePage config={{ ...config, extraFields: fields }} />
    </div>
  );
}
