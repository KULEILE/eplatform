import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

// Batch 30 — "i said to you do not duplicate the services. service or document and its renewal
// they must in one place": a New, an Imported/SADC, and a Second-Hand Local registration used to
// be three separate tiles/pages (VehicleRegistration.jsx, VehicleRegistrationImported.jsx,
// VehicleRegistrationSecondHand.jsx) that otherwise did almost the same thing. They're one page
// now, with a type selector — exactly the pattern Driving Licence's Application/Renewal/
// Replacement already established (see its own header comment) — rather than a database change:
// the three service_type values themselves are unchanged (migration 042), so nothing about how a
// record is stored, searched, or displayed had to move. DepartmentServicePage's extraFields can
// now be a function of the selected type for exactly this reason — see its own doc comment.
const TRANSITIONS = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
  'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
  // Batch 30 — "car registration also need physical check of officers ... citizen can fill the
  // form then take a car to traffic so that officer can confirm that is true then approve
  // registration": a registration can no longer reach Approved by document review alone. This
  // officer action opens the requiresText modal (DepartmentServicePage's existing reason/confirm
  // pattern) so the officer records what they actually checked in person — chassis/engine numbers
  // matching, condition — before the record can move any further; the backend rejects an empty
  // note (see traffic.controller.js's 'confirm-physical-inspection').
  'Documents Checked': { action: 'confirm-physical-inspection', labelKey: 'traffic.vehicleRegistrationForm.confirmPhysicalInspection', requiresText: true, textLabelKey: 'traffic.vehicleRegistrationForm.physicalInspectionNotesLabel' },
  'Physically Inspected': { action: 'approve-registration', labelKey: 'common.approve' },
  'Approved': { action: 'ready-for-collection', labelKey: 'common.readyForCollection' },
  'Ready for Collection': { action: 'collect', labelKey: 'common.collect' },
};

const COMMON_FIELDS = (t) => [
  { name: 'vehicleMake', type: 'text', required: true, label: t('traffic.vehicleForm.field.make') },
  { name: 'vehicleModel', type: 'text', required: true, label: t('traffic.vehicleForm.field.model') },
  { name: 'chassisNumber', type: 'text', required: true, label: t('traffic.vehicleForm.field.chassisNumber'), help: t('traffic.vehicleForm.field.chassisNumberHelp') },
  { name: 'engineNumber', type: 'text', required: true, label: t('traffic.vehicleForm.field.engineNumber') },
];

/** New, Imported/SADC, or already-local Second-Hand registration, one page with a type selector.
 *  Imported/SADC gains four extra fields found by checking Lesotho's own published requirements
 *  for registering a vehicle from a SADC country (gov.ls): beyond the purchase/manufacturing
 *  document every type already asks for, an import also needs proof the vehicle actually cleared
 *  customs, that VAT/import duty was paid, and that it isn't reported stolen — see the batch30
 *  README for the full source list. Every type also now needs a preferredOfficeId: "citizen can
 *  fill the form then take a car to traffic" only works if the citizen knows which office to go to. */
export default function VehicleRegistration() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic',
    idColumn: 'traffic_record_id',
    titleKey: 'traffic.vehicleRegistrationForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Vehicle Registration', 'Vehicle Registration (Imported/SADC)', 'Vehicle Registration (Second-Hand Local)'],
    extraFields: (serviceType) => {
      const fields = [
        ...COMMON_FIELDS(t),
        serviceType === 'Vehicle Registration (Imported/SADC)'
          ? { name: 'ownershipProofReference', type: 'photo', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.importProof'), help: t('traffic.vehicleRegistrationImportedForm.field.importProofHelp') }
          : { name: 'ownershipProofReference', type: 'photo', required: true, label: t('traffic.vehicleForm.field.ownershipProof'), help: t('traffic.vehicleForm.field.ownershipProofHelp') },
      ];
      if (serviceType === 'Vehicle Registration (Imported/SADC)') {
        fields.push(
          { name: 'originCountry', type: 'text', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.originCountry') },
          { name: 'customsClearanceReference', type: 'text', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.customsClearance'), help: t('traffic.vehicleRegistrationImportedForm.field.customsClearanceHelp') },
          { name: 'importTaxProofReference', type: 'photo', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.importTaxProof'), help: t('traffic.vehicleRegistrationImportedForm.field.importTaxProofHelp') },
          { name: 'policeClearanceReference', type: 'photo', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.policeClearance'), help: t('traffic.vehicleRegistrationImportedForm.field.policeClearanceHelp') },
        );
      }
      fields.push({ name: 'preferredOfficeId', type: 'office', required: true, label: t('traffic.vehicleRegistrationForm.field.preferredOffice') });
      return fields;
    },
    transitions: TRANSITIONS,
    formNotice: t('traffic.vehicleRegistrationForm.physicalInspectionNotice'),
  };
  return <DepartmentServicePage config={config} />;
}
