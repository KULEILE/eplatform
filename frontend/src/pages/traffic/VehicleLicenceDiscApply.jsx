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

/** A vehicle cannot be licensed without proof of insurance — enforced server-side. */
export default function VehicleLicenceDiscApply() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic',
    idColumn: 'traffic_record_id',
    titleKey: 'traffic.licenceDiscApplyForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Vehicle Licence Disc Application'],
    extraFields: [
      { name: 'vehicleRegistrationNumber', type: 'text', required: true, label: t('traffic.vehicleTransferForm.field.vehicleRegistrationNumber') },
      { name: 'insuranceProofReference', type: 'photo', required: true, label: t('traffic.licenceDiscApplyForm.field.insuranceProof'), help: t('traffic.licenceDiscApplyForm.field.insuranceProofHelp') },
    ],
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
