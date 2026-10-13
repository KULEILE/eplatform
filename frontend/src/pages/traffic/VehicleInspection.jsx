import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const TRANSITIONS = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'check-documents', labelKey: 'status.Documents Checked' },
  'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
  'Processing': { action: 'approve', labelKey: 'common.approve' },
};

/** Roadworthiness test & Certificate of Fitness, combined into one workflow — passing the
 *  inspection IS what issues the COF, the same way approving a licence application issues the
 *  licence number. Requires an already-registered vehicle (checked server-side). */
export default function VehicleInspection() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic/inspections',
    idColumn: 'vehicle_inspection_id',
    titleKey: 'traffic.inspectionForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Roadworthiness Test & Certificate of Fitness'],
    extraFields: [
      { name: 'vehicleRegistrationNumber', type: 'text', required: true, label: t('traffic.vehicleTransferForm.field.vehicleRegistrationNumber') },
      { name: 'officeId', type: 'office', required: true },
    ],
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
