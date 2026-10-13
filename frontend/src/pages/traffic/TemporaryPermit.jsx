import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const TRANSITIONS = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
  'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
  'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
  'Processing': { action: 'approve', labelKey: 'common.approve' },
  'Approved': { action: 'ready-for-collection', labelKey: 'common.readyForCollection' },
  'Ready for Collection': { action: 'collect', labelKey: 'common.collect' },
};

export default function TemporaryPermit() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic',
    idColumn: 'traffic_record_id',
    titleKey: 'traffic.temporaryPermitForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Temporary Permit (Awaiting Registration)'],
    extraFields: [
      { name: 'vehicleMake', type: 'text', required: true, label: t('traffic.vehicleForm.field.make') },
      { name: 'chassisNumber', type: 'text', required: true, label: t('traffic.vehicleForm.field.chassisNumber'), help: t('traffic.vehicleForm.field.chassisNumberHelp') },
      { name: 'temporaryPermitValidUntil', type: 'date', required: true, label: t('traffic.temporaryPermitForm.field.validUntil') },
    ],
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
