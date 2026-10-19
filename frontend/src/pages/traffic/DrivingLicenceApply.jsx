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

/** A driving licence identifies a specific person and is checked against their own captured
 *  photo and fingerprints — see migration 042 and traffic.controller.js's beforeApply. */
export default function DrivingLicenceApply() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic',
    idColumn: 'traffic_record_id',
    titleKey: 'traffic.drivingLicenceApplyForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Driving Licence Application'],
    extraFields: [
      { name: 'photoReference', type: 'photo', required: true, label: t('traffic.drivingLicenceApplyForm.photo'), help: t('photoCapture.idHelp'), faceCheck: true },
      { name: 'biometricReferenceLeft', type: 'biometric', required: true, label: t('biometricCapture.leftHandLabel'), help: t('biometricCapture.scanHint'), enrollSource: 'Driving Licence Application' },
      { name: 'biometricReferenceRight', type: 'biometric', required: true, label: t('biometricCapture.rightHandLabel'), help: t('biometricCapture.scanHint'), enrollSource: 'Driving Licence Application' },
      { name: 'preferredOfficeId', type: 'office', required: true },
    ],
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
