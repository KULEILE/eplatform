const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');

// A driving credential identifies a specific person and must be checked against that person's
// own captured photo and fingerprints, exactly like a National ID card — see migrations
// 007/034/036 and homeAffairs.controller.js's applyNationalId. Previously traffic_records
// accepted these with nothing but a bare serviceType; see migration 042.
//
// Driving Licence Application/Renewal/Replacement and Learner Permit moved OUT of this generic
// department-factory controller in migration 067 / driving_licence.controller.js and
// trafficServices2.controller.js: a Learner Permit is no longer something a citizen applies for
// directly (it is produced automatically after passing the theory and practical driving tests),
// and a driving licence now needs eligibility logic (reusing the National ID photo/fingerprints,
// requiring a valid Learner Permit for a first licence, blocking early renewal unless damaged,
// a 3-month lost/stolen wait, a single-confirm Learner Permit surrender at collection) that this
// shared factory has no hook for. Public Driving Permit stays here — nothing about it changed.
//
// Batch 29 — "the biomatrix must be captured once during id application so everywhere they are
// need they used reuse that one ... there is no self biomatric captured": a Public Driving Permit
// used to make the citizen supply photoReference/biometricReferenceLeft/biometricReferenceRight
// directly in the apply request — in practice that meant the frontend handed them a camera to
// scan their own hands fresh, exactly the self-capture this system's design principle forbids
// (hand biometrics are captured exactly once, in person, during National ID enrolment, and reused
// everywhere after — see drivingLicence.controller.js's resolveIdentityCapture, which does the
// same thing for an actual driving licence). beforeApply below now resolves those three fields
// itself, server-side, from the citizen's own collected national_id_cards row, and overwrites
// whatever the client sent — the generic factory's apply() reads them back out of req.body AFTER
// beforeApply runs, so mutating req.body here is how this shared factory gets server-resolved
// values without needing its own bespoke insert logic.
const DRIVING_CREDENTIAL_TYPES = ['Public Driving Permit'];

/** The citizen's photo reference from their own collected National ID card — same query
 *  drivingLicence.controller.js's getIdCapture runs, duplicated here in this much smaller
 *  generic-factory controller rather than importing across controllers for one query. Returns
 *  null if the citizen holds no Collected National ID at all. */
async function getNationalIdCapture(citizenId) {
  const { rows } = await db.query(
    `SELECT photo_reference, biometric_reference_left, biometric_reference_right
     FROM national_id_cards WHERE citizen_id = $1 AND production_status = 'Collected' ORDER BY approval_date DESC LIMIT 1`,
    [citizenId]
  );
  return rows[0] || null;
}

/** True once BOTH hands are on file in citizen_biometrics for this citizen — the actual, current
 *  source of truth for biometric completeness (migration 063 moved real capture there, done in
 *  person at a police station; it stopped populating national_id_cards.biometric_reference_left/
 *  right entirely). Same check, same reasoning, as drivingLicence.controller.js's
 *  hasBothHandsEnrolled and homeAffairs.controller.js's own — see either's comment for why
 *  checking the old national_id_cards columns here would permanently lock out every citizen
 *  enrolled since that change. */
async function hasBothHandsEnrolled(citizenId) {
  const { rows } = await db.query(
    'SELECT left_hand_captured_at, right_hand_captured_at FROM citizen_biometrics WHERE citizen_id = $1',
    [citizenId]
  );
  return !!(rows[0] && rows[0].left_hand_captured_at && rows[0].right_hand_captured_at);
}
const VEHICLE_REGISTRATION_TYPES = [
  'Vehicle Registration', 'Vehicle Registration (Imported/SADC)', 'Vehicle Registration (Second-Hand Local)',
];

/** Confirms the citizen already holds an approved record in traffic_records matching `column`
 *  = `value` — used for every service that only makes sense against an already-registered
 *  vehicle or an already-issued licence (plates, licence discs, transfers, PDP), so an
 *  application can't reference a vehicle or licence that was never actually approved. */
async function citizenHasApprovedRecord(citizenId, column, value) {
  const { rows } = await db.query(
    `SELECT 1 FROM traffic_records WHERE citizen_id = $1 AND ${column} = $2
     AND status IN ('Approved', 'Ready for Collection', 'Collected')`,
    [citizenId, value]
  );
  return rows.length > 0;
}

async function beforeApply(req) {
  const { serviceType } = req.body;
  const b = req.body;
  const citizenId = req.user.citizenId;

  if (DRIVING_CREDENTIAL_TYPES.includes(serviceType)) {
    if (!b.preferredOfficeId) return { error: 'preferredOfficeId is required — choose the branch where you will collect it.' };
    // Batch 29: never trust a client-sent photo/biometric reference — always resolve it
    // server-side from the citizen's own National ID capture, the same way a driving licence
    // application does. A citizen is never asked (or allowed) to self-capture fresh ones here.
    const idCapture = await getNationalIdCapture(citizenId);
    const biometricsEnrolled = await hasBothHandsEnrolled(citizenId);
    if (!idCapture || !idCapture.photo_reference || !biometricsEnrolled) {
      return {
        status: 409,
        error: "Your National ID record does not have a complete photo and fingerprint capture on file yet. Biometrics are captured once, in person, as part of National ID enrolment — please complete that first, then apply for this permit.",
      };
    }
    b.photoReference = idCapture.photo_reference;
    b.biometricReferenceLeft = idCapture.biometric_reference_left || null;
    b.biometricReferenceRight = idCapture.biometric_reference_right || null;
  }

  if (serviceType === 'Public Driving Permit') {
    if (!b.existingLicenceNumber) return { error: 'existingLicenceNumber is required — a Public Driving Permit is issued against an existing driving licence, not on its own.' };
    if (!(await citizenHasApprovedRecord(citizenId, 'licence_number', b.existingLicenceNumber))) {
      return { error: 'No approved driving licence with that number was found on your record.' };
    }
  }

  if (VEHICLE_REGISTRATION_TYPES.includes(serviceType)) {
    if (!b.vehicleMake || !b.vehicleModel) return { error: 'vehicleMake and vehicleModel are required.' };
    if (!b.chassisNumber || !b.engineNumber) return { error: 'chassisNumber and engineNumber are required to uniquely identify the vehicle and prevent duplicate registration.' };
    if (!b.ownershipProofReference) return { error: 'A photo of your proof of purchase/import document is required.' };
    if (serviceType === 'Vehicle Registration (Imported/SADC)' && !b.originCountry) {
      return { error: 'originCountry is required for an imported or SADC vehicle registration.' };
    }
  }

  if (serviceType === 'Vehicle Transfer') {
    if (!b.vehicleRegistrationNumber) return { error: 'vehicleRegistrationNumber is required — the vehicle being transferred.' };
    if (!b.newOwnerPermanentIdentityNumber) return { error: 'newOwnerPermanentIdentityNumber is required — confirms who the vehicle is being transferred to.' };
    if (!b.ownershipProofReference) return { error: 'A photo of the signed sale/transfer document is required.' };
    if (!(await citizenHasApprovedRecord(citizenId, 'vehicle_registration_number', b.vehicleRegistrationNumber))) {
      return { error: 'No registered vehicle with that registration number was found on your record.' };
    }
  }

  if (serviceType === 'Vehicle Number Plate') {
    if (!b.vehicleRegistrationNumber) return { error: 'vehicleRegistrationNumber is required.' };
    if (!b.plateRequestReason) return { error: 'plateRequestReason is required (New, Lost, Damaged, or Personalised).' };
    if (b.plateRequestReason === 'Personalised' && !b.personalisedPlateText) {
      return { error: 'personalisedPlateText is required for a personalised plate request.' };
    }
    if (!(await citizenHasApprovedRecord(citizenId, 'vehicle_registration_number', b.vehicleRegistrationNumber))) {
      return { error: 'No registered vehicle with that registration number was found on your record.' };
    }
  }

  if (serviceType === 'Temporary Permit (Awaiting Registration)') {
    if (!b.vehicleMake || !b.chassisNumber) return { error: 'vehicleMake and chassisNumber are required, even for a temporary permit.' };
    if (!b.temporaryPermitValidUntil) return { error: 'temporaryPermitValidUntil is required.' };
  }

  if (['Vehicle Licence Disc Application', 'Vehicle Licence Disc Renewal'].includes(serviceType)) {
    if (!b.vehicleRegistrationNumber) return { error: 'vehicleRegistrationNumber is required.' };
    if (!b.insuranceProofReference) return { error: 'A photo of your proof of insurance is required — a vehicle cannot be licensed without proof of insurance.' };
    if (!(await citizenHasApprovedRecord(citizenId, 'vehicle_registration_number', b.vehicleRegistrationNumber))) {
      return { error: 'No registered vehicle with that registration number was found on your record.' };
    }
    if (serviceType === 'Vehicle Licence Disc Renewal' && !b.previousDiscNumber) {
      return { error: 'previousDiscNumber is required for a renewal.' };
    }
  }

  return null;
}

function genNumber(prefix) {
  return `${prefix}-${String(Math.floor(100000 + Math.random() * 900000))}`;
}
function drivingLicenceApprove(prefix, years) {
  return () => ({
    setSql: `licence_number = $3, issue_date = CURRENT_DATE, expiry_date = CURRENT_DATE + INTERVAL '${years} years'`,
    params: [genNumber(prefix)],
  });
}
function vehicleRegistrationApprove() {
  return { setSql: `vehicle_registration_number = $3, issue_date = CURRENT_DATE`, params: [genNumber('LSB')] };
}

// What "approve" actually does depends on the service type — mirrors the original inline
// isLicence/isVehicle string-matching, but as an explicit lookup: that heuristic would have
// mismatched several of the new service types (e.g. "Vehicle Licence Disc" contains "Licence"
// but issues no licence number at all).
const APPROVE_EXTRA = {
  'Public Driving Permit': drivingLicenceApprove('PDP', 1),
  'Vehicle Registration': vehicleRegistrationApprove,
  'Vehicle Registration (Imported/SADC)': vehicleRegistrationApprove,
  'Vehicle Registration (Second-Hand Local)': vehicleRegistrationApprove,
  'Vehicle Transfer': () => ({ setSql: `issue_date = CURRENT_DATE`, params: [] }),
  'Vehicle Number Plate': () => ({ setSql: `issue_date = CURRENT_DATE`, params: [] }),
  'Temporary Permit (Awaiting Registration)': () => ({ setSql: `issue_date = CURRENT_DATE, expiry_date = temporary_permit_valid_until`, params: [] }),
  'Vehicle Licence Disc Application': () => ({ setSql: `issue_date = CURRENT_DATE, expiry_date = CURRENT_DATE + INTERVAL '1 year'`, params: [] }),
  'Vehicle Licence Disc Renewal': () => ({ setSql: `issue_date = CURRENT_DATE, expiry_date = CURRENT_DATE + INTERVAL '1 year'`, params: [] }),
};

const controller = makeDepartmentController({
  table: 'traffic_records',
  idColumn: 'traffic_record_id',
  deptKey: 'traffic',
  officerRoleKey: 'traffic_officer',
  refPrefix: 'TR',
  serviceTypes: [
    'Vehicle Registration', 'Vehicle Transfer', 'Public Driving Permit',
    'Vehicle Registration (Imported/SADC)', 'Vehicle Registration (Second-Hand Local)',
    'Vehicle Number Plate', 'Temporary Permit (Awaiting Registration)',
    'Vehicle Licence Disc Application', 'Vehicle Licence Disc Renewal',
  ],
  beforeApply,
  extraInsertFields: [
    { column: 'photo_reference', fromBody: 'photoReference' },
    { column: 'biometric_reference_left', fromBody: 'biometricReferenceLeft' },
    { column: 'biometric_reference_right', fromBody: 'biometricReferenceRight' },
    { column: 'preferred_office_id', fromBody: 'preferredOfficeId' },
    { column: 'collection_office_id', fromBody: 'preferredOfficeId' },
    { column: 'replacement_reason', fromBody: 'replacementReason' },
    { column: 'previous_licence_number', fromBody: 'previousLicenceNumber' },
    { column: 'existing_licence_number', fromBody: 'existingLicenceNumber' },
    { column: 'vehicle_make', fromBody: 'vehicleMake' },
    { column: 'vehicle_model', fromBody: 'vehicleModel' },
    { column: 'chassis_number', fromBody: 'chassisNumber' },
    { column: 'engine_number', fromBody: 'engineNumber' },
    { column: 'origin_country', fromBody: 'originCountry' },
    { column: 'ownership_proof_reference', fromBody: 'ownershipProofReference' },
    { column: 'new_owner_permanent_identity_number', fromBody: 'newOwnerPermanentIdentityNumber' },
    { column: 'vehicle_registration_number', fromBody: 'vehicleRegistrationNumber' },
    { column: 'plate_request_reason', fromBody: 'plateRequestReason' },
    { column: 'personalised_plate_text', fromBody: 'personalisedPlateText' },
    { column: 'temporary_permit_valid_until', fromBody: 'temporaryPermitValidUntil' },
    { column: 'insurance_proof_reference', fromBody: 'insuranceProofReference' },
    { column: 'previous_disc_number', fromBody: 'previousDiscNumber' },
  ],
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'verify-identity': { from: 'Under Review', to: 'Identity Verified' },
    'check-documents': { from: 'Identity Verified', to: 'Documents Checked' },
    'process': { from: 'Documents Checked', to: 'Processing' },
    'approve': {
      from: 'Processing', to: 'Approved',
      extra: (record) => (APPROVE_EXTRA[record.service_type] ? APPROVE_EXTRA[record.service_type](record) : null),
    },
    'ready-for-collection': { from: 'Approved', to: 'Ready for Collection' },
    'collect': { from: 'Ready for Collection', to: 'Collected' },
  },
});

module.exports = controller;
