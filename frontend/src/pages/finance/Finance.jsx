import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

// These two services have their own pages (SupplierPaymentTracking.jsx, FinanceComplaint.jsx)
// with their own forms and officer actions, so they are kept out of the generic list below.
const OWN_PAGE_TYPES = ['Government Supplier Payment Tracking', 'Finance Complaint or Enquiry'];

const config = {
  apiBase: '/finance',
  idColumn: 'finance_record_id',
  titleKey: 'finance.title',
  serviceTypeNs: 'finance',
  officerRoleKey: 'finance_officer',
  serviceTypes: ['Supplier Registration Validation', 'Payment Information Update', 'Tax Identity Confirmation', 'Financial Records Correction'],
  listFilter: (r) => !OWN_PAGE_TYPES.includes(r.service_type),
  transitions: {
    'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
    'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
    'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
    'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
    'Processing': { action: 'complete', labelKey: 'status.Completed' },
  },
};

const LINKS = [
  { to: '/finance/government-employment', icon: '🏛', labelKeys: ['finance.employment.panelTitle', 'finance.retirement.title'] },
  { to: '/finance/retirement-tracking', icon: '📈', labelKeys: ['finance.retirementTracking.title'] },
  { to: '/finance/supplier-payments', icon: '🧾', labelKeys: ['finance.supplierPayment.title'] },
  { to: '/finance/complaints', icon: '💬', labelKeys: ['finance.complaint.title'] },
  { to: '/finance/publications', icon: '📄', labelKeys: ['finance.publications.title'] },
  { to: '/finance/corrections', icon: '✏', labelKeys: ['finance.correction'] },
];

export default function Finance() {
  const { t } = useLanguage();
  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-3 text-sm">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="font-medium text-gov-navy hover:underline">
            {l.icon} {l.labelKeys.map((k) => t(k)).join(' / ')}
          </Link>
        ))}
      </div>
      <DepartmentServicePage config={config} />
    </div>
  );
}
