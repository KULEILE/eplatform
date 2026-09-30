import React from 'react';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const config = {
  apiBase: '/traffic',
  titleKey: 'traffic.title',
  serviceTypeNs: 'traffic',
  officerRoleKey: 'traffic_officer',
  serviceTypes: ['Driving Licence Application', 'Driving Licence Renewal', 'Vehicle Registration', 'Vehicle Transfer', 'Learner Permit'],
  transitions: {
    'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
    'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
    'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
    'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
    'Processing': { action: 'approve', labelKey: 'common.approve' },
    'Approved': { action: 'ready-for-collection', labelKey: 'common.readyForCollection' },
    'Ready for Collection': { action: 'collect', labelKey: 'common.collect' },
  },
};

export default function Traffic() {
  return <DepartmentServicePage config={config} />;
}
