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

/** Covers a new import, a vehicle bought in South Africa, or a vehicle from another SADC
 *  country as one workflow — originCountry tells customs/compliance where it came from. */
export default function VehicleRegistrationImported() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic',
    idColumn: 'traffic_record_id',
    titleKey: 'traffic.vehicleRegistrationImportedForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Vehicle Registration (Imported/SADC)'],
    extraFields: [
      { name: 'vehicleMake', type: 'text', required: true, label: t('traffic.vehicleForm.field.make') },
      { name: 'vehicleModel', type: 'text', required: true, label: t('traffic.vehicleForm.field.model') },
      { name: 'chassisNumber', type: 'text', required: true, label: t('traffic.vehicleForm.field.chassisNumber'), help: t('traffic.vehicleForm.field.chassisNumberHelp') },
      { name: 'engineNumber', type: 'text', required: true, label: t('traffic.vehicleForm.field.engineNumber') },
      { name: 'originCountry', type: 'text', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.originCountry') },
      { name: 'ownershipProofReference', type: 'photo', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.importProof'), help: t('traffic.vehicleRegistrationImportedForm.field.importProofHelp') },
    ],
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
