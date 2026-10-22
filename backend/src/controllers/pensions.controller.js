const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');
const { makeRespondHandler } = require('../utils/respondToEnquiry');

const ENQUIRY_SERVICE_TYPE = 'Pension Status Enquiry';

// Lesotho's Old Age Pension is a universal, non-contributory benefit paid from age 70. A
// citizen's date_of_birth is already verified by Home Affairs at enrolment, so a claim here
// never asks them to re-enter it — it's checked against the record already on file, the same
// "verified identity is the source of truth" principle the rest of this system follows.
const PENSION_ELIGIBILITY_AGE = 70;

// Civil Service Pension: standard retirement age depends on the employee's category — ordinary
// civil servants retire at 60, uniformed/disciplined services (police, soldiers, correctional
// service officers) retire at 55, reflecting the physical demands of that work. This only
// applies when the retirement reason was 'Standard' — any other reason (ill-health, medical
// boarding, compulsory retirement, redundancy...) waives the age check entirely, because a
// Finance officer has already reviewed documented grounds for retiring early; that approval is
// the real gate, not a specific age this system would otherwise have to guess at per reason.
const CIVIL_SERVICE_RETIREMENT_AGE = 60;
const UNIFORMED_SERVICES_RETIREMENT_AGE = 55;

const AGE_CLAIM = 'Pension Age Eligibility Claim';
const CIVIL_SERVICE_CLAIM = 'Civil Service Pension Claim';
const PENSION_TYPES = [AGE_CLAIM, CIVIL_SERVICE_CLAIM];

function calculateAge(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
}

async function beforeApply(req) {
  const serviceType = req.body.serviceType;
  const { rows } = await db.query(
    'SELECT date_of_birth, is_deceased, government_employment_status, employee_category, retirement_reason FROM citizens WHERE citizen_id = $1',
    [req.user.citizenId]
  );
  if (rows.length === 0) return { status: 400, error: 'Citizen record not found.' };
  const citizen = rows[0];

  // Pension Enquiry and Tracking: the citizen's actual question is required.
  if (serviceType === ENQUIRY_SERVICE_TYPE && (!req.body.enquiryText || !String(req.body.enquiryText).trim())) {
    return { status: 400, error: 'Please type your question.' };
  }

  // A citizen Home Affairs has on record as deceased cannot submit any pension service — most
  // importantly, they can never "prove" they are alive. (See approveDeath in
  // homeAffairs.controller.js, which also auto-stops any pension this same citizen already held.)
  if (citizen.is_deceased) {
    return { status: 409, error: 'Our records show this citizen as deceased. No further pension services can be submitted for this identity.' };
  }

  // A citizen is eligible for exactly one pension type, for life — never both, never a switch
  // from one to the other later.
  if (PENSION_TYPES.includes(serviceType)) {
    const otherType = serviceType === AGE_CLAIM ? CIVIL_SERVICE_CLAIM : AGE_CLAIM;
    const { rows: otherRows } = await db.query(
      `SELECT 1 FROM pension_records WHERE citizen_id = $1 AND service_type = $2 AND status != 'Rejected'`,
      [req.user.citizenId, otherType]
    );
    if (otherRows.length > 0) {
      return { status: 409, error: `You already hold a pension under '${otherType}'. A citizen is only eligible for one pension type.` };
    }
  }

  if (serviceType === AGE_CLAIM) {
    if (!citizen.date_of_birth) {
      return { status: 400, error: 'Your date of birth is not on file yet — this must be verified with Home Affairs before a pension age claim can be checked.' };
    }
    // Being a currently active government employee blocks the Old Age Pension too, regardless
    // of age — nobody draws a salary and a pension at the same time. It only unlocks once
    // Finance's record shows them as no longer active (Retired, or never a government employee).
    if (citizen.government_employment_status === 'Active') {
      return { status: 400, error: 'Our records show you are still an active government employee. The Old Age Pension cannot be claimed until you have retired — this is recorded by the Finance department.' };
    }
    const age = calculateAge(citizen.date_of_birth);
    if (age < PENSION_ELIGIBILITY_AGE) {
      return {
        status: 400,
        error: `Our records show your verified date of birth makes you ${age} years old. The Old Age Pension is payable from age ${PENSION_ELIGIBILITY_AGE}. If you believe your date of birth on file is incorrect, please submit a correction request with Home Affairs first.`,
      };
    }
  }

  if (serviceType === CIVIL_SERVICE_CLAIM) {
    // Finance's record is the gate, never the claimant's own word — this can only be 'Retired'
    // once a Finance officer has approved a retirement declaration (see finance.controller.js).
    if (citizen.government_employment_status !== 'Retired') {
      return { status: 400, error: 'Our records do not show you as a retired government employee. Please submit a retirement declaration with the Finance department first.' };
    }
    if (!citizen.date_of_birth) {
      return { status: 400, error: 'Your date of birth is not on file yet — this must be verified with Home Affairs before a pension claim can be checked.' };
    }
    if (!citizen.retirement_reason || citizen.retirement_reason === 'Standard') {
      const standardAge = citizen.employee_category === 'Uniformed/Disciplined Services' ? UNIFORMED_SERVICES_RETIREMENT_AGE : CIVIL_SERVICE_RETIREMENT_AGE;
      const age = calculateAge(citizen.date_of_birth);
      if (age < standardAge) {
        return {
          status: 400,
          error: `Our records show your verified date of birth makes you ${age} years old. Standard retirement for your category requires age ${standardAge}.`,
        };
      }
    }
    // Any other retirement reason (Ill-health, Medical Boarding, Compulsory Retirement,
    // Redundancy, Other) waives the age check — Finance's approval of the retirement declaration
    // already is the eligibility decision for an early retirement.
  }

  return null;
}

const controller = makeDepartmentController({
  table: 'pension_records',
  idColumn: 'pension_record_id',
  deptKey: 'pensions',
  officerRoleKey: 'pensions_officer',
  refPrefix: 'PEN',
  serviceTypes: ['New Pension Enrolment', 'Proof of Life Verification', 'Beneficiary Correction', ENQUIRY_SERVICE_TYPE, AGE_CLAIM, CIVIL_SERVICE_CLAIM],
  extraInsertFields: [
    { column: 'enquiry_text', fromBody: 'enquiryText' },
  ],
  finalStatuses: ['Rejected', 'Completed', 'Stopped (Deceased)'],
  beforeApply,
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'verify-identity': { from: 'Under Review', to: 'Identity Verified' },
    'process': { from: 'Identity Verified', to: 'Processing' },
    'complete': { from: 'Processing', to: 'Completed' },
    // Automated proof-of-life mismatch: the beneficiary is not removed from the system —
    // they are flagged with a clear correction path, per the report's design requirement.
    'flag-for-correction': {
      from: 'Processing', to: 'Flagged for Correction',
      extra: () => ({ setSql: `life_status = 'Under Review'`, params: [] }),
    },
    'resolve-correction': {
      from: 'Flagged for Correction', to: 'Completed',
      extra: () => ({ setSql: `life_status = 'Alive'`, params: [] }),
    },
  },
});

// POST /api/pensions/:id/respond — officer answers a pension enquiry (see utils/respondToEnquiry.js).
const respond = makeRespondHandler({
  table: 'pension_records', idColumn: 'pension_record_id', officerRoleKey: 'pensions_officer', serviceType: ENQUIRY_SERVICE_TYPE,
});

module.exports = { ...controller, respond };
