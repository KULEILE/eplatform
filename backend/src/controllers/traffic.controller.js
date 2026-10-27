const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');
const { generateReference } = require('../utils/referenceGenerator');
const { indexApplication } = require('../utils/lookup');
const { createNotification } = require('../utils/notify');

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
  'Vehicle Registration', 'Vehicle Registration (Imported/SADC)', 'Vehicle Registration (Second-Hand Imported)',
];

// Batch 31 — from a written workflow document the citizen supplied specifying the real vehicle-
// registration process. "Keep requirements configurable so that authorised administrators can
// update them when official rules change" (document Section 10) — this is the one place that
// decides both (a) which document fields a registration category requires and (b) whether that
// category needs customs clearance verified at all. beforeApply and the statusFlow guards below
// both read from this object rather than each having their own bespoke per-type logic, so a future
// rule change (RSL starts requiring a 5th document, say) is one edit here, not a hunt through two
// different functions. Deliberately a plain in-code object rather than a database table + admin
// screen for now — lower risk and ships immediately; a database-backed version is a natural later
// step if this needs to change often enough that a code deploy becomes the bottleneck.
const COMMON_VEHICLE_REGISTRATION_FIELDS = [
  { field: 'vehicleMake', message: 'vehicleMake and vehicleModel are required.' },
  { field: 'vehicleModel', message: 'vehicleMake and vehicleModel are required.' },
  { field: 'chassisNumber', message: 'chassisNumber and engineNumber are required to uniquely identify the vehicle and prevent duplicate registration.' },
  { field: 'engineNumber', message: 'chassisNumber and engineNumber are required to uniquely identify the vehicle and prevent duplicate registration.' },
  { field: 'ownershipProofReference', message: 'A photo of your proof of purchase/import document is required.' },
  { field: 'preferredOfficeId', message: 'preferredOfficeId is required — choose the traffic office where you will bring the vehicle for physical inspection.' },
];
// Researched against Lesotho's own published requirements for registering a vehicle imported from
// a SADC country (gov.ls): beyond the ownership/manufacturing document every registration already
// needs, an import additionally needs customs clearance (Form CE 11), proof of VAT payment, and a
// CID/Interpol (SARPCO) police clearance confirming the vehicle isn't reported stolen. RSL (Revenue
// Services Lesotho) itself operates outside this platform — the citizen obtains these documents
// from RSL directly and uploads them here; this system never claims to contact RSL automatically.
const CUSTOMS_VEHICLE_REGISTRATION_FIELDS = [
  { field: 'originCountry', message: 'originCountry is required for an imported or SADC vehicle registration.' },
  { field: 'customsClearanceReference', message: 'customsClearanceReference is required (the Customs clearance / Form CE 11 reference number) for an imported or SADC vehicle registration.' },
  // Batch 32 — the reference number above is just a typed string; this is the actual customs
  // clearance document/certificate itself, so the officer verifying customs clearance has a real
  // document to review, the same as every other proof requirement already asks for a photo.
  { field: 'customsClearanceDocumentReference', message: 'A photo of your customs clearance document/certificate from RSL is required for an imported or SADC vehicle registration.' },
  { field: 'importTaxProofReference', message: 'A photo of your proof of VAT/import duty payment is required for an imported or SADC vehicle registration.' },
  { field: 'policeClearanceReference', message: 'A photo of your CID/Interpol (SARPCO) police clearance is required for an imported or SADC vehicle registration, to confirm the vehicle is not reported stolen.' },
];
const VEHICLE_REGISTRATION_REQUIREMENTS = {
  // Brand-new, purchased in Lesotho — no customs paperwork exists to produce.
  'Vehicle Registration': { requiresCustoms: false, requiredFields: COMMON_VEHICLE_REGISTRATION_FIELDS },
  // Brand-new, imported (including from a SADC country).
  'Vehicle Registration (Imported/SADC)': { requiresCustoms: true, requiredFields: [...COMMON_VEHICLE_REGISTRATION_FIELDS, ...CUSTOMS_VEHICLE_REGISTRATION_FIELDS] },
  // Second-hand, imported into Lesotho for the first time — needs the same customs paperwork as a
  // brand-new import (a second-hand vehicle already registered in Lesotho changing hands is
  // Vehicle Transfer's job, not this one — see this controller's VehicleRegistration.jsx comment).
  'Vehicle Registration (Second-Hand Imported)': { requiresCustoms: true, requiredFields: [...COMMON_VEHICLE_REGISTRATION_FIELDS, ...CUSTOMS_VEHICLE_REGISTRATION_FIELDS] },
};
function requiresCustoms(serviceType) {
  return !!(VEHICLE_REGISTRATION_REQUIREMENTS[serviceType] && VEHICLE_REGISTRATION_REQUIREMENTS[serviceType].requiresCustoms);
}

// Batch 30 — "we building system not realistic ... the pdp citizen must be at least 21 year have
// to two year of experience driving to obtain the system must check how long does the citizen
// hold her license and if is less than two year they are not qualifying for pdp". Kept as named
// constants rather than bare numbers so the rule is stated once and findable.
const PDP_MIN_AGE_YEARS = 21;
const PDP_MIN_LICENCE_YEARS = 2;

// A citizen's own driving licence lives in traffic_records too (service_type one of these three —
// see drivingLicence.controller.js), carrying the SAME three values across renewals/replacements.
// "How long has this citizen held a licence" is the earliest Collected issue_date among them — the
// exact first_issue_date computation drivingLicence.controller.js's own getOne already uses for its
// card's "First Issue" display, duplicated here for the same reason getNationalIdCapture duplicates
// a query from drivingLicence.controller.js rather than importing across controllers.
const DRIVING_LICENCE_SERVICE_TYPES = ['Driving Licence Application', 'Driving Licence Renewal', 'Driving Licence Replacement'];

// Batch 30 — "the system should automatically generate the temporary permit after registration
// which last only 21 days after that days it must generate number plate automatically." 21 days
// mirrors the standard SADC-region practice of a short-lived temporary permit covering a new
// vehicle while its permanent plate is produced (see South Africa's National Road Traffic Act
// regulation on the validity of a temporary permit) — named here rather than left as a bare number
// sprinkled through the file.
const TEMP_PERMIT_VALID_DAYS = 21;

/** Confirms the citizen already holds an approved record in traffic_records matching `column`
 *  = `value` — used for every service that only makes sense against an already-registered
 *  vehicle or an already-issued licence (plates, licence discs, transfers), so an
 *  application can't reference a vehicle or licence that was never actually approved. */
async function citizenHasApprovedRecord(citizenId, column, value) {
  const { rows } = await db.query(
    `SELECT 1 FROM traffic_records WHERE citizen_id = $1 AND ${column} = $2
     AND status IN ('Approved', 'Ready for Collection', 'Collected')`,
    [citizenId, value]
  );
  return rows.length > 0;
}

/** Batch 30 PDP eligibility: the citizen must (a) actually hold the driving licence number they
 *  gave, Collected, and (b) be at least PDP_MIN_AGE_YEARS old, and (c) have held a driving licence
 *  — first Collected issue_date, carried across renewals/replacements — for at least
 *  PDP_MIN_LICENCE_YEARS. All three computed server-side in one query; nothing here trusts a
 *  client-sent age or tenure. Returns { error } when ineligible, or the figures themselves
 *  ({ ageYears, licenceYearsHeld, firstIssueDate }) when eligible, so the eligibility GET endpoint
 *  below can show a citizen their own numbers even while still ineligible. */
async function checkPdpEligibility(citizenId, existingLicenceNumber) {
  const { rows } = await db.query(
    `SELECT
       DATE_PART('year', AGE(CURRENT_DATE, c.date_of_birth))::int AS age_years,
       fi.first_issue_date,
       CASE WHEN fi.first_issue_date IS NOT NULL
            THEN DATE_PART('year', AGE(CURRENT_DATE, fi.first_issue_date))::int
            ELSE NULL END AS licence_years_held
     FROM citizens c
     LEFT JOIN LATERAL (
       SELECT MIN(issue_date) AS first_issue_date FROM traffic_records
       WHERE citizen_id = c.citizen_id AND licence_number = $2 AND service_type = ANY($3::varchar[])
         AND status = 'Collected' AND issue_date IS NOT NULL
     ) fi ON true
     WHERE c.citizen_id = $1`,
    [citizenId, existingLicenceNumber, DRIVING_LICENCE_SERVICE_TYPES]
  );
  const row = rows[0];
  if (!row || !row.first_issue_date) {
    return { error: 'No collected driving licence with that number was found on your record.' };
  }
  const { age_years: ageYears, licence_years_held: licenceYearsHeld, first_issue_date: firstIssueDate } = row;
  if (ageYears === null || ageYears < PDP_MIN_AGE_YEARS) {
    return { error: `You must be at least ${PDP_MIN_AGE_YEARS} years old to hold a Public Driving Permit${ageYears !== null ? ` — our records show you are ${ageYears}` : ''}.` };
  }
  if (licenceYearsHeld === null || licenceYearsHeld < PDP_MIN_LICENCE_YEARS) {
    return { error: `You must have held a driving licence for at least ${PDP_MIN_LICENCE_YEARS} years to qualify for a Public Driving Permit. Yours has been held for ${licenceYearsHeld ?? 0} year(s), first issued ${String(firstIssueDate).slice(0, 10)}.` };
  }
  return { ageYears, licenceYearsHeld, firstIssueDate };
}

/** GET /traffic/public-driving-permit/eligibility — lets the form show the citizen their own
 *  numbers (and why they don't yet qualify, if they don't) before they fill anything in, the same
 *  way driving licence's own eligibility endpoint does, rather than only finding out after
 *  submitting. existingLicenceNumber is a query param here since there's no application yet to
 *  attach it to. */
async function getPdpEligibility(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to use this service.' });
    const { existingLicenceNumber } = req.query;
    if (!existingLicenceNumber) return res.json({ eligible: null, minAge: PDP_MIN_AGE_YEARS, minLicenceYears: PDP_MIN_LICENCE_YEARS });
    const result = await checkPdpEligibility(req.user.citizenId, existingLicenceNumber);
    if (result.error) return res.json({ eligible: false, reason: result.error, minAge: PDP_MIN_AGE_YEARS, minLicenceYears: PDP_MIN_LICENCE_YEARS });
    res.json({ eligible: true, ...result, minAge: PDP_MIN_AGE_YEARS, minLicenceYears: PDP_MIN_LICENCE_YEARS });
  } catch (err) { next(err); }
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
    const eligibility = await checkPdpEligibility(citizenId, b.existingLicenceNumber);
    if (eligibility.error) return { error: eligibility.error };
  }

  if (VEHICLE_REGISTRATION_TYPES.includes(serviceType)) {
    for (const requirement of VEHICLE_REGISTRATION_REQUIREMENTS[serviceType].requiredFields) {
      if (!b[requirement.field]) return { error: requirement.message };
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
    if (!b.plateRequestReason) return { error: 'plateRequestReason is required (Lost, Damaged, or Personalised).' };
    // Batch 30 — a brand-new plate is never something a citizen requests any more: it's generated
    // automatically, 21 days after their vehicle registration is approved (see
    // sweepExpiredTemporaryPermits below). 'New' stays a valid DB value (that's exactly what the
    // system writes for an auto-generated plate) but a citizen applying for one directly is
    // rejected here, same principle as Batch 29's "no self biometric captured" — some values are
    // for the system to set, never the citizen.
    if (b.plateRequestReason === 'New') {
      return { error: "A brand-new number plate is issued automatically, 21 days after your vehicle registration is approved — it isn't something you request directly. Choose 'Lost', 'Damaged', or 'Personalised' if you already have a plate and need a different one." };
    }
    if (b.plateRequestReason === 'Personalised' && !b.personalisedPlateText) {
      return { error: 'personalisedPlateText is required for a personalised plate request.' };
    }
    if (!(await citizenHasApprovedRecord(citizenId, 'vehicle_registration_number', b.vehicleRegistrationNumber))) {
      return { error: 'No registered vehicle with that registration number was found on your record.' };
    }
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
//
// Batch 30: Vehicle Registration is deliberately NOT listed here any more — it no longer reaches
// 'Approved' via the shared 'process'/'approve' actions at all (see 'confirm-physical-inspection'
// and 'approve-registration' below, which exist only so a registration can't skip the physical
// inspection gate). Temporary Permit is also gone — it's never approved by an officer; it's
// created already-Approved, by the system, the moment a registration is (see afterTransition).
const APPROVE_EXTRA = {
  'Public Driving Permit': drivingLicenceApprove('PDP', 1),
  'Vehicle Transfer': () => ({ setSql: `issue_date = CURRENT_DATE`, params: [] }),
  'Vehicle Number Plate': () => ({ setSql: `issue_date = CURRENT_DATE`, params: [] }),
  'Vehicle Licence Disc Application': () => ({ setSql: `issue_date = CURRENT_DATE, expiry_date = CURRENT_DATE + INTERVAL '1 year'`, params: [] }),
  'Vehicle Licence Disc Renewal': () => ({ setSql: `issue_date = CURRENT_DATE, expiry_date = CURRENT_DATE + INTERVAL '1 year'`, params: [] }),
};

/** Guards an action so it can only ever move a Vehicle Registration record — defence in depth:
 *  the frontend only ever shows these buttons on a Vehicle Registration row, but the backend
 *  shouldn't rely on that alone, since the generic transition() endpoint takes a bare action name
 *  and record id with no service_type check of its own. Returns an error object (the same shape
 *  t.extra() returns to abort a transition) when the record isn't actually a registration. */
function requireVehicleRegistration(record) {
  if (!VEHICLE_REGISTRATION_TYPES.includes(record.service_type)) {
    return { error: 'This action only applies to a vehicle registration.' };
  }
  return null;
}

/** Batch 32 — "during inspection the officer must type the chassis and engine number and the
 *  system so detect if they are the same as the owner entered if they differ application must not
 *  continue": normalizes a chassis/engine number for comparison (trims, uppercases, and strips
 *  internal whitespace) so a harmless formatting difference — lowercase, an extra space — doesn't
 *  register as a mismatch, while an actually different number still does. */
function normalizeVehicleNumber(value) {
  return (value || '').trim().toUpperCase().replace(/\s+/g, '');
}

/** Shared by 'confirm-physical-inspection' (local registrations, straight from Documents Checked)
 *  and 'confirm-physical-inspection-after-customs' (imports, after customs clearance has already
 *  been verified) — see statusFlow below. Requires a non-empty officer note, same as before, PLUS
 *  (Batch 32) the officer's own typed chassis/engine numbers, cross-checked against what the
 *  citizen entered on the application. A mismatch refuses the transition outright — the citizen's
 *  decided answer here (see the Batch 32 README) is that the system only BLOCKS the step on a
 *  mismatch; it never auto-rejects on its own. The officer still has to look at the mismatch and
 *  decide — typo vs. a genuinely different vehicle — the same way they'd use "Reject" or "Request
 *  more information" for any other problem with an application. */
function physicalInspectionExtra(record, req) {
  const notes = (req.body.officerResponse || '').trim();
  if (!notes) return { error: 'Inspection notes are required — confirm the vehicle was physically brought in and that its chassis and engine numbers match the application.' };
  const officerChassisNumber = (req.body.officerChassisNumber || '').trim();
  const officerEngineNumber = (req.body.officerEngineNumber || '').trim();
  if (!officerChassisNumber || !officerEngineNumber) {
    return { error: 'You must type the chassis number and engine number you see on the vehicle itself — these are compared against what the citizen entered on the application.' };
  }
  if (normalizeVehicleNumber(officerChassisNumber) !== normalizeVehicleNumber(record.chassis_number)) {
    return { error: `The chassis number you entered ("${officerChassisNumber}") does not match the chassis number on the application ("${record.chassis_number}"). The application cannot continue until this is resolved — use "Reject" or "Request more information" if this is a genuine discrepancy, not a typo.` };
  }
  if (normalizeVehicleNumber(officerEngineNumber) !== normalizeVehicleNumber(record.engine_number)) {
    return { error: `The engine number you entered ("${officerEngineNumber}") does not match the engine number on the application ("${record.engine_number}"). The application cannot continue until this is resolved — use "Reject" or "Request more information" if this is a genuine discrepancy, not a typo.` };
  }
  return {
    setSql: `physical_inspection_confirmed_at = NOW(), physical_inspection_confirmed_by_user_id = $3, physical_inspection_notes = $4, physical_inspection_chassis_number = $5, physical_inspection_engine_number = $6`,
    params: [req.user.userId, notes, officerChassisNumber, officerEngineNumber],
  };
}

const controller = makeDepartmentController({
  table: 'traffic_records',
  idColumn: 'traffic_record_id',
  deptKey: 'traffic',
  officerRoleKey: 'traffic_officer',
  refPrefix: 'TR',
  serviceTypes: [
    // Batch 30: 'Temporary Permit (Awaiting Registration)' removed from this list — a citizen can
    // no longer apply for one directly (POST /apply rejects it before beforeApply even runs, since
    // apply() checks serviceTypes.includes(serviceType) first). It's created automatically, already
    // Approved, the moment a Vehicle Registration is — see afterTransition below. The row still
    // uses this exact service_type string so every existing display/translation/tracking path
    // (My Applications, this very table) shows it exactly like any other record.
    'Vehicle Registration', 'Vehicle Transfer', 'Public Driving Permit',
    'Vehicle Registration (Imported/SADC)', 'Vehicle Registration (Second-Hand Imported)',
    'Vehicle Number Plate',
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
    { column: 'customs_clearance_reference', fromBody: 'customsClearanceReference' },
    { column: 'customs_clearance_document_reference', fromBody: 'customsClearanceDocumentReference' },
    { column: 'import_tax_proof_reference', fromBody: 'importTaxProofReference' },
    { column: 'police_clearance_reference', fromBody: 'policeClearanceReference' },
    { column: 'new_owner_permanent_identity_number', fromBody: 'newOwnerPermanentIdentityNumber' },
    { column: 'vehicle_registration_number', fromBody: 'vehicleRegistrationNumber' },
    { column: 'plate_request_reason', fromBody: 'plateRequestReason' },
    { column: 'personalised_plate_text', fromBody: 'personalisedPlateText' },
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
    // Batch 30 — "car registration also need physical check of officers ... citizen can fill the
    // form then take a car to traffic so that officer can confirm that is true then approve
    // registration". A Vehicle Registration never uses 'process'/'approve' above (both still work
    // exactly as before for Transfer/PDP/Plate/Disc) — it uses this pair instead, so it's
    // structurally impossible to approve one without first confirming the vehicle was physically
    // brought in. requireVehicleRegistration guards both against being called on any other
    // service type by a stray/direct API call.
    //
    // Batch 31 — "keep customs verification separate from document uploading" (from the citizen's
    // workflow document): for the two registration categories that involve an import, an officer
    // must ALSO explicitly verify the RSL customs documents — a distinct step, with its own note
    // and audit trail, from confirming the vehicle itself was physically brought in. This needs two
    // different entry points into "confirm physical inspection" (one straight from Documents
    // Checked for a local registration with no customs step, one from Customs Clearance Verified
    // for an import) because this factory's statusFlow only supports one {from,to} pair per action
    // name — see physicalInspectionExtra, shared by both so the actual inspection logic is written
    // once.
    'verify-customs-clearance': {
      from: 'Documents Checked', to: 'Customs Clearance Verified',
      extra: (record, req) => {
        const guard = requireVehicleRegistration(record);
        if (guard) return guard;
        if (!requiresCustoms(record.service_type)) {
          return { error: 'This action only applies to an imported vehicle registration — this registration type has no customs paperwork to verify.' };
        }
        const notes = (req.body.officerResponse || '').trim();
        if (!notes) return { error: 'Verification notes are required — confirm the customs clearance, import tax proof, and police clearance documents were checked and are genuine.' };
        return {
          setSql: `customs_clearance_verified_at = NOW(), customs_clearance_verified_by_user_id = $3, customs_clearance_verification_notes = $4`,
          params: [req.user.userId, notes],
        };
      },
    },
    'confirm-physical-inspection': {
      from: 'Documents Checked', to: 'Physically Inspected',
      extra: (record, req) => {
        const guard = requireVehicleRegistration(record);
        if (guard) return guard;
        if (requiresCustoms(record.service_type)) {
          return { error: 'Customs clearance must be verified before the physical inspection step for this registration type — use "Verify customs clearance" first.' };
        }
        return physicalInspectionExtra(record, req);
      },
    },
    'confirm-physical-inspection-after-customs': {
      from: 'Customs Clearance Verified', to: 'Physically Inspected',
      extra: (record, req) => {
        const guard = requireVehicleRegistration(record);
        if (guard) return guard;
        return physicalInspectionExtra(record, req);
      },
    },
    'approve-registration': {
      from: 'Physically Inspected', to: 'Approved',
      extra: (record) => {
        const guard = requireVehicleRegistration(record);
        if (guard) return guard;
        return vehicleRegistrationApprove();
      },
    },
    'ready-for-collection': { from: 'Approved', to: 'Ready for Collection' },
    'collect': { from: 'Ready for Collection', to: 'Collected' },
  },
  // Batch 30 — "the system should automatically generate the temporary permit after registration
  // which last only 21 days". Runs inside the same DB transaction as the 'approve-registration'
  // UPDATE above, so the temporary permit either exists or the whole approval rolls back together
  // — there's no window where a registration is Approved but has no permit yet. Re-reads the row
  // via `client` (not the pre-transition `record` this hook receives) because vehicle_registration_
  // number was only just assigned by vehicleRegistrationApprove()'s own UPDATE a moment ago.
  afterTransition: async (client, record, toStatus, req) => {
    if (toStatus !== 'Approved' || !VEHICLE_REGISTRATION_TYPES.includes(record.service_type)) return;
    const { rows } = await client.query(
      `SELECT vehicle_registration_number, vehicle_make, vehicle_model, chassis_number, engine_number
       FROM traffic_records WHERE traffic_record_id = $1`,
      [record.traffic_record_id]
    );
    const reg = rows[0];
    if (!reg || !reg.vehicle_registration_number) return;
    const referenceNumber = generateReference('TR');
    const { rows: inserted } = await client.query(
      `INSERT INTO traffic_records (
         citizen_id, application_reference, service_type, status,
         vehicle_registration_number, vehicle_make, vehicle_model, chassis_number, engine_number,
         temporary_permit_valid_until, issue_date, linked_registration_id
       ) VALUES ($1,$2,'Temporary Permit (Awaiting Registration)','Approved',$3,$4,$5,$6,$7,
                 CURRENT_DATE + INTERVAL '${TEMP_PERMIT_VALID_DAYS} days', CURRENT_DATE, $8)
       RETURNING traffic_record_id`,
      [record.citizen_id, referenceNumber, reg.vehicle_registration_number, reg.vehicle_make, reg.vehicle_model, reg.chassis_number, reg.engine_number, record.traffic_record_id]
    );
    await indexApplication(client, {
      citizenId: record.citizen_id, departmentKey: 'traffic', serviceType: 'Temporary Permit (Awaiting Registration)',
      referenceNumber, sourceTable: 'traffic_records', sourceId: inserted[0].traffic_record_id, status: 'Approved',
    });
    const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
    if (userRow) {
      await createNotification({
        userId: userRow.user_id, title: 'Temporary permit issued', type: 'Approval',
        message: `Your vehicle registration (${reg.vehicle_registration_number}) was approved. A temporary permit (reference ${referenceNumber}) is valid for ${TEMP_PERMIT_VALID_DAYS} days while your permanent number plate is produced — it will be issued automatically when the permit expires.`,
      });
    }
  },
});

/** Batch 30 — "after that days it must generate number plate automatically." Finds every
 *  auto-issued Temporary Permit whose temporary_permit_valid_until has passed and that doesn't
 *  already have a plate generated against its registration, and creates the Vehicle Number Plate
 *  record for each — already Approved (nothing for an officer to review: the registration itself
 *  was already physically inspected and approved), ready for the citizen to collect the physical
 *  plate. Safe to call repeatedly/concurrently: each permit is only ever matched once the
 *  NOT EXISTS check below finds no plate yet, and that check plus the insert run in one
 *  transaction per permit. Called from three places — see server.js's startup/hourly sweep, this
 *  controller's own `list` (a lazy catch-up so a citizen or officer loading the page sees a
 *  just-expired permit convert immediately rather than waiting for the next hourly tick), and the
 *  POST /traffic/sweep-temporary-permits route for manual/cron triggering — so it's exported here
 *  rather than kept private. Returns how many plates it generated. */
async function sweepExpiredTemporaryPermits() {
  const { rows: expired } = await db.query(
    `SELECT * FROM traffic_records tp
     WHERE tp.service_type = 'Temporary Permit (Awaiting Registration)' AND tp.status = 'Approved'
       AND tp.temporary_permit_valid_until < CURRENT_DATE
       AND tp.linked_registration_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM traffic_records p
         WHERE p.service_type = 'Vehicle Number Plate' AND p.linked_registration_id = tp.linked_registration_id
       )`
  );
  let issued = 0;
  for (const permit of expired) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const referenceNumber = generateReference('TR');
      const { rows: inserted } = await client.query(
        `INSERT INTO traffic_records (citizen_id, application_reference, service_type, status, vehicle_registration_number, plate_request_reason, issue_date, linked_registration_id)
         VALUES ($1,$2,'Vehicle Number Plate','Approved',$3,'New',CURRENT_DATE,$4) RETURNING traffic_record_id`,
        [permit.citizen_id, referenceNumber, permit.vehicle_registration_number, permit.linked_registration_id]
      );
      await indexApplication(client, {
        citizenId: permit.citizen_id, departmentKey: 'traffic', serviceType: 'Vehicle Number Plate',
        referenceNumber, sourceTable: 'traffic_records', sourceId: inserted[0].traffic_record_id, status: 'Approved',
      });
      await client.query('COMMIT');
      issued += 1;
      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [permit.citizen_id])).rows[0];
      if (userRow) {
        await createNotification({
          userId: userRow.user_id, title: 'Number plate ready for collection', type: 'Ready for Collection',
          message: `Your temporary permit for ${permit.vehicle_registration_number} has expired and your permanent number plate (reference ${referenceNumber}) is ready — visit your traffic office to collect it.`,
        });
      }
    } catch (err) {
      await client.query('ROLLBACK');
      // eslint-disable-next-line no-console
      console.error(`sweepExpiredTemporaryPermits: failed to issue a plate for temporary permit ${permit.traffic_record_id}:`, err.message);
    } finally {
      client.release();
    }
  }
  return issued;
}

/** Lazy catch-up wrapper around the generic factory's own `list` — see sweepExpiredTemporaryPermits'
 *  doc comment. Swallows a sweep failure rather than ever letting it break the page load it's
 *  piggybacking on; the hourly sweep in server.js and the manual route both still run/exist
 *  independently of this. */
async function listWithSweep(req, res, next) {
  try { await sweepExpiredTemporaryPermits(); } catch (err) { /* see hourly sweep in server.js */ }
  return controller.list(req, res, next);
}

/** POST /traffic/sweep-temporary-permits — this route sits behind requireAuth like every other
 *  traffic route (see traffic.routes.js), so only a signed-in officer/admin can ever reach it; it
 *  just lets them trigger the sweep on demand (e.g. for support, or right after a permit's expiry
 *  date has clearly passed) without waiting for the next hourly tick. The REAL automatic mechanism
 *  doesn't go through HTTP at all — see server.js's startup/hourly call to
 *  sweepExpiredTemporaryPermits() directly, plus this controller's own listWithSweep catch-up. */
async function sweepTemporaryPermitsRoute(req, res, next) {
  try {
    if (!['traffic_officer', 'system_administrator'].includes(req.user.roleKey)) {
      return res.status(403).json({ error: 'Officer only.' });
    }
    const issued = await sweepExpiredTemporaryPermits();
    res.json({ platesIssued: issued });
  } catch (err) { next(err); }
}

module.exports = { ...controller, list: listWithSweep, getPdpEligibility, sweepExpiredTemporaryPermits, sweepTemporaryPermitsRoute };
