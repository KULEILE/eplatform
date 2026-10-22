import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

// 'Pension Status Enquiry' now has its own page (PensionEnquiry.jsx) where the citizen types
// their question and sees the officer's answer, so it is no longer offered in the generic form.
const ENQUIRY_TYPE = 'Pension Status Enquiry';

const config = {
  apiBase: '/pensions',
  idColumn: 'pension_record_id',
  titleKey: 'pensions.title',
  serviceTypeNs: 'pensions',
  officerRoleKey: 'pensions_officer',
  serviceTypes: ['New Pension Enrolment', 'Proof of Life Verification', 'Beneficiary Correction', 'Pension Age Eligibility Claim', 'Civil Service Pension Claim'],
  listFilter: (r) => r.service_type !== ENQUIRY_TYPE,
  finalStatuses: ['Rejected', 'Completed', 'Stopped (Deceased)'],
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
  const { t } = useLanguage();
  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-x-6 gap-y-3 text-sm">
        <Link to="/pensions/enquiry" className="font-medium text-gov-navy hover:underline">💬 {t('pensions.enquiry.title')}</Link>
        <Link to="/finance/retirement-tracking" className="font-medium text-gov-navy hover:underline">📈 {t('finance.retirementTracking.title')}</Link>
      </div>
      <DepartmentServicePage config={config} />
    </div>
  );
}
