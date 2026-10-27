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

/** Batch 30 — "the system should automatically generate the temporary permit after registration
 *  which last only 21 days after that days it must generate number plate automatically": a brand
 *  New plate is no longer something a citizen requests here — it's created automatically (see
 *  traffic.controller.js's sweepExpiredTemporaryPermits) once a vehicle's 21-day Temporary Permit
 *  expires, linked back to that registration. This form now only covers a Lost, Damaged, or
 *  Personalised plate for a vehicle that's already registered. personalisedPlateText is only
 *  actually required when plateRequestReason is 'Personalised' — enforced server-side (see
 *  traffic.controller.js's beforeApply); the help text below says so, since this generic form
 *  can't conditionally require a field based on another field's value. */
export default function VehicleNumberPlate() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic',
    idColumn: 'traffic_record_id',
    titleKey: 'traffic.numberPlateForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Vehicle Number Plate'],
    extraFields: [
      { name: 'vehicleRegistrationNumber', type: 'text', required: true, label: t('traffic.vehicleTransferForm.field.vehicleRegistrationNumber') },
      {
        name: 'plateRequestReason', type: 'select', required: true,
        label: t('traffic.numberPlateForm.field.reason'),
        options: [
          { value: 'Lost', label: t('traffic.plateRequestReason.lost') },
          { value: 'Damaged', label: t('traffic.plateRequestReason.damaged') },
          { value: 'Personalised', label: t('traffic.plateRequestReason.personalised') },
        ],
      },
      { name: 'personalisedPlateText', type: 'text', label: t('traffic.numberPlateForm.field.personalisedText'), help: t('traffic.numberPlateForm.field.personalisedTextHelp') },
    ],
    transitions: TRANSITIONS,
    formNotice: t('traffic.numberPlateForm.newPlateAutoNotice'),
  };
  return <DepartmentServicePage config={config} />;
}
