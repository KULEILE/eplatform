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

/** Issued against an existing driving licence — the backend confirms one is on file before
 *  accepting the application (see traffic.controller.js's beforeApply). */
export default function PublicDrivingPermit() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic',
    idColumn: 'traffic_record_id',
    titleKey: 'traffic.publicDrivingPermitForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Public Driving Permit'],
    extraFields: [
      { name: 'existingLicenceNumber', type: 'text', required: true, label: t('traffic.publicDrivingPermitForm.field.existingLicenceNumber'), help: t('traffic.publicDrivingPermitForm.field.existingLicenceNumberHelp') },
      { name: 'photoReference', type: 'photo', required: true, label: t('traffic.drivingLicenceApplyForm.photo'), help: t('photoCapture.idHelp'), faceCheck: true },
      { name: 'biometricReferenceLeft', type: 'biometric', required: true, label: t('biometricCapture.leftHandLabel'), help: t('biometricCapture.scanHint') },
      { name: 'biometricReferenceRight', type: 'biometric', required: true, label: t('biometricCapture.rightHandLabel'), help: t('biometricCapture.scanHint') },
      { name: 'preferredOfficeId', type: 'office', required: true },
    ],
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
