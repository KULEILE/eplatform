const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');

// Lesotho's Old Age Pension is a universal, non-contributory benefit paid from age 70. A
// citizen's date_of_birth is already verified by Home Affairs at enrolment, so a claim here
// never asks them to re-enter it — it's checked against the record already on file, the same
// "verified identity is the source of truth" principle the rest of this system follows.
const PENSION_ELIGIBILITY_AGE = 70;

function calculateAge(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
  return age;
}

async function beforeApply(req) {
  if (req.body.serviceType !== 'Pension Age Eligibility Claim') return null;
  const { rows } = await db.query('SELECT date_of_birth FROM citizens WHERE citizen_id = $1', [req.user.citizenId]);
  if (rows.length === 0 || !rows[0].date_of_birth) {
    return { status: 400, error: 'Your date of birth is not on file yet — this must be verified with Home Affairs before a pension age claim can be checked.' };
  }
  const age = calculateAge(rows[0].date_of_birth);
  if (age < PENSION_ELIGIBILITY_AGE) {
    return {
      status: 400,
      error: `Our records show your verified date of birth makes you ${age} years old. The Old Age Pension is payable from age ${PENSION_ELIGIBILITY_AGE}. If you believe your date of birth on file is incorrect, please submit a correction request with Home Affairs first.`,
    };
  }
  return null;
}

const controller = makeDepartmentController({
  table: 'pension_records',
  idColumn: 'pension_record_id',
  deptKey: 'pensions',
  officerRoleKey: 'pensions_officer',
  refPrefix: 'PEN',
  serviceTypes: ['New Pension Enrolment', 'Proof of Life Verification', 'Beneficiary Correction', 'Pension Status Enquiry', 'Pension Age Eligibility Claim'],
  finalStatuses: ['Rejected', 'Completed'],
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

module.exports = controller;
