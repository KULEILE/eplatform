import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

// 'Pension Status Enquiry' has its own dedicated page (PensionEnquiry.jsx) — same precedent as
// GovernmentEmployment.jsx being split out of Finance.jsx — because it needs config.responseField
// and the 'respond-enquiry' text-collecting action, which don't make sense alongside this
// generic multi-type form.
const config = {
  apiBase: '/pensions',
  idColumn: 'pension_record_id',
  titleKey: 'pensions.title',
  serviceTypeNs: 'pensions',
  officerRoleKey: 'pensions_officer',
  serviceTypes: ['New Pension Enrolment', 'Proof of Life Verification', 'Beneficiary Correction', 'Pension Age Eligibility Claim', 'Civil Service Pension Claim'],
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
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['pensions_officer', 'system_administrator'].includes(user.roleKey);
  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-4 text-sm">
        <Link to="/pensions/enquiry" className="font-medium text-gov-navy hover:underline">
          ❓ {t('pensions.enquiry.title')}
        </Link>
        {isOfficer && (
          <Link to="/pensions/payments" className="font-medium text-gov-navy hover:underline">
            💰 {t('pensions.payments.title')}
          </Link>
        )}
      </div>
      <DepartmentServicePage config={config} />
    </div>
  );
}
