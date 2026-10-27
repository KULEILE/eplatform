import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

// Batch 30 — "i said to you do not duplicate the services. service or document and its renewal
// they must in one place": a New, an Imported/SADC, and a Second-Hand registration used to be
// three separate tiles/pages (VehicleRegistration.jsx, VehicleRegistrationImported.jsx,
// VehicleRegistrationSecondHand.jsx) that otherwise did almost the same thing. They're one page
// now, with a type selector — exactly the pattern Driving Licence's Application/Renewal/
// Replacement already established (see its own header comment) — rather than a database change:
// the service_type values themselves are unchanged strings (migration 042), so nothing about how
// a record is stored, searched, or displayed had to move. DepartmentServicePage's extraFields can
// now be a function of the selected type for exactly this reason — see its own doc comment.
//
// Batch 31 — the citizen supplied a written workflow document ("VEHICLE REGISTRATION: IMPORTED
// VEHICLES") naming 4 real-world categories: brand-new bought locally, brand-new imported,
// second-hand imported, and a change of ownership on a vehicle ALREADY registered in Lesotho. That
// 4th one is exactly what Vehicle Transfer already does — building it again here would repeat the
// same duplication Batch 30 was told to fix, so it's handled below as a plain explanation + link,
// never a form. Batch 30's third type, 'Vehicle Registration (Second-Hand Local)', didn't
// correspond to any of the document's 4 categories and is renamed (migration 075) to 'Vehicle
// Registration (Second-Hand Imported)', which does — and which needs the same customs paperwork
// as a brand-new import, since both are crossing a border for the first time.
//
// Batch 32 — two follow-ups after reviewing Batch 31: (1) the category guide card below is now
// citizen-only (an officer isn't choosing a category, they're reviewing an existing one); (2) the
// citizen must now upload the actual customs clearance DOCUMENT, not just type its reference
// number (migration 076), and the physical-inspection step now requires the officer to type the
// chassis/engine numbers they actually see on the vehicle, which the backend cross-checks against
// what the citizen entered and refuses to continue on a mismatch (physicalInspectionExtra in
// traffic.controller.js) — see this file's INSPECTION_NUMBER_FIELDS and the Batch 32 README.
//
// requiresCustomsClearance mirrors traffic.controller.js's VEHICLE_REGISTRATION_REQUIREMENTS —
// duplicated client-side the same way this codebase already duplicates a handful of other small
// server-side checks (see e.g. getNationalIdCapture's own comment) rather than sharing a module
// across the frontend/backend boundary. The backend's beforeApply and statusFlow guards are the
// real enforcement either way; this only decides which fields/actions the UI offers up front.
function requiresCustomsClearance(serviceType) {
  return serviceType === 'Vehicle Registration (Imported/SADC)' || serviceType === 'Vehicle Registration (Second-Hand Imported)';
}

// Batch 32 — "during inspection the officer must type the chassis and engine number and the
// system must detect if they are the same as the owner entered — if they differ application must
// not continue": both physical-inspection actions now also require the officer's own typed
// chassis/engine numbers (requiresFields — see DepartmentServicePage's doc comment), posted
// alongside the existing notes and checked server-side (traffic.controller.js's
// physicalInspectionExtra) against what the citizen entered when they applied. A mismatch blocks
// the step only — it does not auto-reject the application (the citizen's own choice: see the
// Batch 32 README).
const INSPECTION_NUMBER_FIELDS = [
  { name: 'officerChassisNumber', labelKey: 'traffic.vehicleRegistrationForm.officerChassisNumberLabel' },
  { name: 'officerEngineNumber', labelKey: 'traffic.vehicleRegistrationForm.officerEngineNumberLabel' },
];

// Batch 31 — "keep customs verification separate from document uploading": an imported
// registration now passes through an extra 'Customs Clearance Verified' status (migration 075)
// between Documents Checked and Physically Inspected, so these next-action labels depend on the
// RECORD's own service type, not just its status — hence a function rather than a plain object
// (see DepartmentServicePage's doc comment for transitions).
function nextAction(record) {
  switch (record.status) {
    case 'Submitted': return { action: 'start-review', labelKey: 'status.Under Review' };
    case 'Under Review': return { action: 'verify-identity', labelKey: 'status.Identity Verified' };
    case 'Identity Verified': return { action: 'check-documents', labelKey: 'status.Documents Checked' };
    case 'Documents Checked':
      // Batch 30 — "car registration also need physical check of officers ... citizen can fill the
      // form then take a car to traffic so that officer can confirm that is true then approve
      // registration": a registration can no longer reach Approved by document review alone.
      return requiresCustomsClearance(record.service_type)
        ? { action: 'verify-customs-clearance', labelKey: 'traffic.vehicleRegistrationForm.confirmCustomsClearance', requiresText: true, textLabelKey: 'traffic.vehicleRegistrationForm.customsVerificationNotesLabel' }
        : { action: 'confirm-physical-inspection', labelKey: 'traffic.vehicleRegistrationForm.confirmPhysicalInspection', requiresText: true, textLabelKey: 'traffic.vehicleRegistrationForm.physicalInspectionNotesLabel', requiresFields: INSPECTION_NUMBER_FIELDS };
    case 'Customs Clearance Verified':
      return { action: 'confirm-physical-inspection-after-customs', labelKey: 'traffic.vehicleRegistrationForm.confirmPhysicalInspection', requiresText: true, textLabelKey: 'traffic.vehicleRegistrationForm.physicalInspectionNotesLabel', requiresFields: INSPECTION_NUMBER_FIELDS };
    case 'Physically Inspected': return { action: 'approve-registration', labelKey: 'common.approve' };
    case 'Approved': return { action: 'ready-for-collection', labelKey: 'common.readyForCollection' };
    case 'Ready for Collection': return { action: 'collect', labelKey: 'common.collect' };
    default: return null;
  }
}

const COMMON_FIELDS = (t) => [
  { name: 'vehicleMake', type: 'text', required: true, label: t('traffic.vehicleForm.field.make') },
  { name: 'vehicleModel', type: 'text', required: true, label: t('traffic.vehicleForm.field.model') },
  { name: 'chassisNumber', type: 'text', required: true, label: t('traffic.vehicleForm.field.chassisNumber'), help: t('traffic.vehicleForm.field.chassisNumberHelp') },
  { name: 'engineNumber', type: 'text', required: true, label: t('traffic.vehicleForm.field.engineNumber') },
];

/** New, Imported/SADC, or Second-Hand Imported registration, one page with a type selector. Both
 *  import categories gain the same 4 extra fields, found by checking Lesotho's own published
 *  requirements for registering a vehicle from a SADC country (gov.ls): beyond the purchase/
 *  manufacturing document every type already asks for, an import also needs proof the vehicle
 *  actually cleared customs, that VAT/import duty was paid, and that it isn't reported stolen —
 *  see the batch30/batch31 READMEs for the full source list. Every type also needs a
 *  preferredOfficeId: "citizen can fill the form then take a car to traffic" only works if the
 *  citizen knows which office to go to. */
export default function VehicleRegistration() {
  const { user } = useAuth();
  const { t } = useLanguage();
  // Batch 32 — "officer do not need to see this message": the category guide is advice for a
  // citizen deciding which type to apply under; an officer only ever sees existing applications
  // and already knows the record's type, so showing it in their queue view was just noise.
  const isOfficer = user.roleKey === 'traffic_officer' || user.roleKey === 'system_administrator';
  const config = {
    apiBase: '/traffic',
    idColumn: 'traffic_record_id',
    titleKey: 'traffic.vehicleRegistrationForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Vehicle Registration', 'Vehicle Registration (Imported/SADC)', 'Vehicle Registration (Second-Hand Imported)'],
    extraFields: (serviceType) => {
      const imported = requiresCustomsClearance(serviceType);
      const fields = [
        ...COMMON_FIELDS(t),
        imported
          ? { name: 'ownershipProofReference', type: 'photo', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.importProof'), help: t('traffic.vehicleRegistrationImportedForm.field.importProofHelp') }
          : { name: 'ownershipProofReference', type: 'photo', required: true, label: t('traffic.vehicleForm.field.ownershipProof'), help: t('traffic.vehicleForm.field.ownershipProofHelp') },
      ];
      if (imported) {
        fields.push(
          { name: 'originCountry', type: 'text', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.originCountry') },
          { name: 'customsClearanceReference', type: 'text', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.customsClearance'), help: t('traffic.vehicleRegistrationImportedForm.field.customsClearanceHelp') },
          // Batch 32 — the reference number above is just the Form CE 11 number the citizen types;
          // this is the actual clearance document/certificate itself, so the officer verifying
          // customs clearance has something real to review, the same as every other proof field.
          { name: 'customsClearanceDocumentReference', type: 'photo', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.customsClearanceDocument'), help: t('traffic.vehicleRegistrationImportedForm.field.customsClearanceDocumentHelp') },
          { name: 'importTaxProofReference', type: 'photo', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.importTaxProof'), help: t('traffic.vehicleRegistrationImportedForm.field.importTaxProofHelp') },
          { name: 'policeClearanceReference', type: 'photo', required: true, label: t('traffic.vehicleRegistrationImportedForm.field.policeClearance'), help: t('traffic.vehicleRegistrationImportedForm.field.policeClearanceHelp') },
        );
      }
      fields.push({ name: 'preferredOfficeId', type: 'office', required: true, label: t('traffic.vehicleRegistrationForm.field.preferredOffice') });
      return fields;
    },
    transitions: nextAction,
    formNotice: t('traffic.vehicleRegistrationForm.physicalInspectionNotice'),
  };
  return (
    <div>
      {/* Batch 31 — the 4th real-world category from the citizen's workflow document (change of
          ownership on a vehicle already registered in Lesotho) is Vehicle Transfer's job, not a
          duplicate form here — see this file's header comment.
          Batch 32 — citizen-only: an officer already knows which type a given application is and
          is never choosing a category for themselves, so this card is hidden for them. */}
      {!isOfficer && (
        <div className="card mb-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">{t('traffic.vehicleRegistrationForm.categoryGuideTitle')}</h2>
          <p className="text-sm text-slate-600">{t('traffic.vehicleRegistrationForm.categoryGuideBody')}</p>
          <p className="mt-2 text-sm text-slate-600">
            {t('traffic.vehicleRegistrationForm.changeOfOwnershipNotice')}{' '}
            <Link to="/traffic/vehicle-transfer" className="font-medium text-gov-navy hover:underline">
              {t('traffic.vehicleRegistrationForm.useVehicleTransferLink')}
            </Link>
          </p>
        </div>
      )}
      <DepartmentServicePage config={config} />
    </div>
  );
}
