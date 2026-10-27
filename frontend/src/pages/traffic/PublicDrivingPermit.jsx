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
 *  accepting the application (see traffic.controller.js's beforeApply).
 *
 *  Batch 29 — "the biomatrix must be captured once during id application so everywhere they are
 *  need they used reuse that one ... there is no self biomatric captured": the photoReference/
 *  biometricReferenceLeft/biometricReferenceRight fields that used to live here are gone. They
 *  made this form hand the citizen a camera to self-capture a fresh photo and hand scan every
 *  time; the photo and both-hand fingerprints are now always the ones already on file from the
 *  citizen's National ID capture, resolved server-side in traffic.controller.js's beforeApply —
 *  this form never asks for them, on first application or on a resubmission.
 *
 *  Batch 30 — "the pdp citizen must be at least 21 year have to two year of experience driving
 *  ... the system must check how long does the citizen hold her license and if is less than two
 *  year they are not qualifying for pdp": as soon as the citizen types in the licence number this
 *  permit would be issued against, DepartmentServicePage's eligibilityCheck debounces a call to
 *  GET /traffic/public-driving-permit/eligibility (traffic.controller.js's getPdpEligibility,
 *  which checks age and licence-tenure server-side against the citizen's own record — never
 *  trusting a client-sent age or date) and shows the result right there, before they can submit —
 *  the backend's beforeApply still enforces this independently either way, so this is purely
 *  "tell them now, not after a wasted trip to the office". */
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
      { name: 'preferredOfficeId', type: 'office', required: true },
    ],
    eligibilityCheck: { fieldName: 'existingLicenceNumber', url: '/traffic/public-driving-permit/eligibility' },
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
