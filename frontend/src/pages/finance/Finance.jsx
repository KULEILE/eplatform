import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const config = {
  apiBase: '/finance',
  idColumn: 'finance_record_id',
  titleKey: 'finance.title',
  serviceTypeNs: 'finance',
  officerRoleKey: 'finance_officer',
  serviceTypes: ['Supplier Registration Validation', 'Payment Information Update', 'Tax Identity Confirmation', 'Financial Records Correction'],
  transitions: {
    'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
    'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
    'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
    'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
    'Processing': { action: 'complete', labelKey: 'status.Completed' },
  },
};

export default function Finance() {
  const { t } = useLanguage();
  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <Link to="/finance/government-employment" className="font-medium text-gov-navy hover:underline">
          🏛 {t('finance.employment.panelTitle')} / {t('finance.retirement.title')}
        </Link>
        <Link to="/finance/corrections" className="font-medium text-gov-navy hover:underline">
          ✏ {t('finance.correction')}
        </Link>
      </div>
      <DepartmentServicePage config={config} />
    </div>
  );
}
