import React from 'react';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const config = {
  apiBase: '/pensions',
  titleKey: 'pensions.title',
  serviceTypeNs: 'pensions',
  officerRoleKey: 'pensions_officer',
  serviceTypes: ['New Pension Enrolment', 'Proof of Life Verification', 'Beneficiary Correction', 'Pension Status Enquiry', 'Pension Age Eligibility Claim'],
  transitions: {
    'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
    'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
    'Identity Verified': { action: 'process', labelKey: 'status.Processing' },
    'Processing': [
      { action: 'complete', labelKey: 'status.Completed' },
      { action: 'flag-for-correction', labelKey: 'status.Flagged for Correction' },
    ],
    'Flagged for Correction': { action: 'resolve-correction', labelKey: 'status.Completed' },
  },
};

export default function Pensions() {
  return <DepartmentServicePage config={config} />;
}
