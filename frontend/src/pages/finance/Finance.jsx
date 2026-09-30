import React from 'react';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const config = {
  apiBase: '/finance',
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
  return <DepartmentServicePage config={config} />;
}
