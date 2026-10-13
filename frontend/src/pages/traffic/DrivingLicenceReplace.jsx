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

export default function DrivingLicenceReplace() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic',
    idColumn: 'traffic_record_id',
    titleKey: 'traffic.drivingLicenceReplaceForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Driving Licence Replacement'],
    extraFields: [
      {
        name: 'replacementReason', type: 'select', required: true,
        label: t('traffic.drivingLicenceReplaceForm.field.reason'),
        options: [
          { value: 'Lost', label: t('traffic.replacementReason.lost') },
          { value: 'Stolen', label: t('traffic.replacementReason.stolen') },
          { value: 'Damaged', label: t('traffic.replacementReason.damaged') },
          { value: 'Other', label: t('traffic.replacementReason.other') },
        ],
      },
      { name: 'previousLicenceNumber', type: 'text', required: true, label: t('traffic.drivingLicenceReplaceForm.field.previousLicenceNumber') },
      { name: 'photoReference', type: 'photo', required: true, label: t('traffic.drivingLicenceApplyForm.photo'), help: t('photoCapture.idHelp') },
      { name: 'biometricReferenceLeft', type: 'biometric', required: true, label: t('biometricCapture.leftHandLabel'), help: t('biometricCapture.scanHint') },
      { name: 'biometricReferenceRight', type: 'biometric', required: true, label: t('biometricCapture.rightHandLabel'), help: t('biometricCapture.scanHint') },
      { name: 'preferredOfficeId', type: 'office', required: true },
    ],
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
