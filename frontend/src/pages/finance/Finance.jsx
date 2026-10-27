import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const config = {
  apiBase: '/finance',
  idColumn: 'finance_record_id',
  titleKey: 'finance.title',
  serviceTypeNs: 'finance',
  officerRoleKey: 'finance_officer',
  // Batch 36 — "remove that tax and validation": Supplier Registration Validation and Tax
  // Identity Confirmation were bare placeholders with no real logic behind them, so they're
  // removed from the citizen-facing options. Left in finance.controller.js's history-rendering
  // path (and the locale files) untouched, so any already-submitted application of either type
  // still displays correctly — only new applications can no longer choose them.
  serviceTypes: ['Payment Information Update', 'Financial Records Correction'],
  transitions: {
    'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
    'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
    'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
    'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
    'Processing': { action: 'complete', labelKey: 'status.Completed' },
  },
};

export default function Finance() {
  const { user } = useAuth();
  const { t } = useLanguage();
  // Branch Budget Requests (migration 078) stays with the existing finance_officer role per
  // the explicit answer "leave it with Finance Officer" — not the new Department Finance
  // Administrator. Shown only to the officers who review/approve/disburse them.
  const canReviewBudgetRequests = ['finance_officer', 'system_administrator'].includes(user.roleKey);
  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <Link to="/finance/government-employment" className="font-medium text-gov-navy hover:underline">
          🏛 {t('finance.employment.panelTitle')} / {t('finance.retirement.title')}
        </Link>
        <Link to="/finance/retirement-tracking" className="font-medium text-gov-navy hover:underline">
          📋 {t('finance.retirementTracking.title')}
        </Link>
        <Link to="/finance/supplier-payments" className="font-medium text-gov-navy hover:underline">
          💰 {t('finance.supplierPayment.title')}
        </Link>
        <Link to="/finance/complaints" className="font-medium text-gov-navy hover:underline">
          📨 {t('finance.complaint.title')}
        </Link>
        <Link to="/finance/publications" className="font-medium text-gov-navy hover:underline">
          📑 {t('finance.publications.title')}
        </Link>
        <Link to="/finance/corrections" className="font-medium text-gov-navy hover:underline">
          ✏ {t('finance.correction')}
        </Link>
        {canReviewBudgetRequests && (
          <Link to="/finance/budget-requests" className="font-medium text-gov-navy hover:underline">
            🏦 {t('finance.budgetRequests.title')}
          </Link>
        )}
      </div>
      <DepartmentServicePage config={config} />
    </div>
  );
}
