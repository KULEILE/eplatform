const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');
const { getDepartmentId } = require('../utils/lookup');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('../utils/notify');
const { checkDuplicateSubmission } = require('../utils/duplicateSubmissionGuard');

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
const STATUS_ENQUIRY = 'Pension Status Enquiry';
const NEW_ENROLMENT = 'New Pension Enrolment';
const PENSION_FINAL_STATUSES = ['Rejected', 'Completed', 'Stopped (Deceased)'];

// "the citizen must not allowed to submit many claim unless other one is rejected" — see
// duplicateSubmissionGuard.js for what 'claim' vs 'recurring' means. New Pension Enrolment and
// both pension TYPES are one-time claims (blocked forever once submitted, unless rejected — on
// top of the existing cross-type exclusivity check further below); Proof of Life, Beneficiary
// Correction and a Status Enquiry are ongoing services a pensioner may legitimately need again.
const PENSION_DUPLICATE_RULES = {
  [NEW_ENROLMENT]: 'claim',
  [AGE_CLAIM]: 'claim',
  [CIVIL_SERVICE_CLAIM]: 'claim',
  'Proof of Life Verification': 'recurring',
  'Beneficiary Correction': 'recurring',
  [STATUS_ENQUIRY]: 'recurring',
};

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

  // 'Pension Status Enquiry' used to be submittable with literally no content — a bare service
  // type and nothing else, which tracked a status but was never actually an enquiry about
  // anything. enquiry_text (migration 056) is what the citizen is actually asking; require it
  // the same way every other service here requires its own real content.
  if (serviceType === STATUS_ENQUIRY && (!req.body.enquiryText || !req.body.enquiryText.trim())) {
    return { status: 400, error: 'enquiryText is required — please describe what you would like to know.' };
  }

  const { rows } = await db.query(
    'SELECT date_of_birth, is_deceased, government_employment_status, employee_category, retirement_reason FROM citizens WHERE citizen_id = $1',
    [req.user.citizenId]
  );
  if (rows.length === 0) return { status: 400, error: 'Citizen record not found.' };
  const citizen = rows[0];

  // A citizen Home Affairs has on record as deceased cannot submit any pension service — most
  // importantly, they can never "prove" they are alive. (See approveDeath in
  // homeAffairs.controller.js, which also auto-stops any pension this same citizen already held.)
  if (citizen.is_deceased) {
    return { status: 409, error: 'Our records show this citizen as deceased. No further pension services can be submitted for this identity.' };
  }

  // "the citizen must not allowed to submit many claim unless other one is rejected" — checked
  // up front, before the pension-type-specific eligibility checks below, so it applies
  // uniformly across every Pensions service.
  if (PENSION_DUPLICATE_RULES[serviceType]) {
    const dupError = await checkDuplicateSubmission({
      table: 'pension_records', citizenId: req.user.citizenId, serviceType,
      mode: PENSION_DUPLICATE_RULES[serviceType], finalStatuses: PENSION_FINAL_STATUSES,
    });
    if (dupError) return { status: 409, error: dupError };
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
  serviceTypes: [NEW_ENROLMENT, 'Proof of Life Verification', 'Beneficiary Correction', STATUS_ENQUIRY, AGE_CLAIM, CIVIL_SERVICE_CLAIM],
  extraInsertFields: [
    { column: 'enquiry_text', fromBody: 'enquiryText' },
  ],
  finalStatuses: PENSION_FINAL_STATUSES,
  beforeApply,
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    // A Pension Status Enquiry is answered directly from 'Under Review' rather than going
    // through verify-identity/Processing — there's nothing to process, it's a question. Guarded
    // against the other five service types, which still go through verify-identity below, so an
    // officer can't accidentally "answer" a pension claim instead of actually processing it.
    'respond-enquiry': {
      from: 'Under Review', to: 'Completed',
      extra: (record, req) => {
        if (record.service_type !== STATUS_ENQUIRY) {
          return { error: 'This action only applies to a Pension Status Enquiry.' };
        }
        if (!req.body.officerResponse || !req.body.officerResponse.trim()) {
          return { error: 'officerResponse is required.' };
        }
        return { setSql: 'officer_response = $3', params: [req.body.officerResponse.trim()] };
      },
    },
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

// ============================================================================================
// PENSION DISBURSEMENT AND TOTALS — "pension department should pay eligible citizens and it
// must show totals of citizen how earning pensions." An eligible, currently-paid pensioner is a
// citizen with a pension_records row of type Pension Age Eligibility Claim or Civil Service
// Pension Claim, approved ('Completed'). A pension stopped for a deceased citizen
// (approveDeath in homeAffairs.controller.js moves it to 'Stopped (Deceased)') naturally drops
// out of this list the moment that happens — never needs its own extra check here.
// ============================================================================================

/** GET /api/pensions/pensioners — officer/admin only. */
async function listPensioners(req, res, next) {
  try {
    if (!['pensions_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const [{ rows: pensioners }, { rows: totalsRows }] = await Promise.all([
      db.query(
        `SELECT pr.pension_record_id, pr.service_type, pr.status, pr.monthly_amount, pr.created_at,
                c.citizen_id, c.first_name, c.last_name, c.permanent_identity_number, c.is_deceased
         FROM pension_records pr JOIN citizens c ON c.citizen_id = pr.citizen_id
         WHERE pr.service_type IN ($1,$2) AND pr.status = 'Completed'
         ORDER BY pr.created_at DESC`,
        [AGE_CLAIM, CIVIL_SERVICE_CLAIM]
      ),
      db.query(
        `SELECT COUNT(DISTINCT pr.citizen_id)::int AS pensioner_count, COALESCE(SUM(pp.amount), 0)::numeric AS total_paid
         FROM pension_records pr LEFT JOIN pension_payments pp ON pp.pension_record_id = pr.pension_record_id
         WHERE pr.service_type IN ($1,$2) AND pr.status = 'Completed'`,
        [AGE_CLAIM, CIVIL_SERVICE_CLAIM]
      ),
    ]);
    res.json({ pensioners, totals: { pensionerCount: totalsRows[0].pensioner_count, totalPaid: totalsRows[0].total_paid } });
  } catch (err) { next(err); }
}

/** PATCH /api/pensions/pensioners/:id/amount  body: { monthlyAmount } — officer/admin only. */
async function setPensionAmount(req, res, next) {
  try {
    if (!['pensions_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { monthlyAmount } = req.body;
    if (monthlyAmount === undefined || monthlyAmount === null || monthlyAmount === '' || Number.isNaN(Number(monthlyAmount)) || Number(monthlyAmount) <= 0) {
      return res.status(400).json({ error: 'monthlyAmount is required and must be a positive number.' });
    }
    const { rows } = await db.query('SELECT status FROM pension_records WHERE pension_record_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Pension record not found.' });
    if (rows[0].status !== 'Completed') return res.status(409).json({ error: 'A pension amount can only be set for a completed/approved pension claim.' });
    await db.query('UPDATE pension_records SET monthly_amount = $1, updated_at = NOW() WHERE pension_record_id = $2', [monthlyAmount, req.params.id]);
    res.json({ pensionRecordId: Number(req.params.id), monthlyAmount: Number(monthlyAmount) });
  } catch (err) { next(err); }
}

/** POST /api/pensions/pensioners/:id/pay  body: { payPeriod: 'YYYY-MM', reference? }
 *  officer/admin only. Amount comes from pension_records.monthly_amount, never the request
 *  body — same reasoning as Finance's paySalary. */
async function payPension(req, res, next) {
  try {
    if (!['pensions_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { payPeriod, reference } = req.body;
    if (!/^\d{4}-\d{2}$/.test(payPeriod || '')) return res.status(400).json({ error: "payPeriod is required, in 'YYYY-MM' format." });
    const { rows } = await db.query(
      `SELECT pr.pension_record_id, pr.citizen_id, pr.status, pr.monthly_amount, c.is_deceased
       FROM pension_records pr JOIN citizens c ON c.citizen_id = pr.citizen_id WHERE pr.pension_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Pension record not found.' });
    const pension = rows[0];
    if (pension.status !== 'Completed') return res.status(409).json({ error: 'Only an approved, completed pension claim can be paid.' });
    if (pension.is_deceased) return res.status(409).json({ error: 'Our records show this citizen as deceased. This pension cannot be paid.' });
    if (!pension.monthly_amount) return res.status(409).json({ error: 'Set a monthly pension amount before recording a payment.' });
    try {
      const { rows: payRows } = await db.query(
        `INSERT INTO pension_payments (pension_record_id, citizen_id, pay_period, amount, reference, paid_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [pension.pension_record_id, pension.citizen_id, payPeriod, pension.monthly_amount, reference || null, req.user.userId]
      );
      await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('pensions'), action: 'PENSION_PAID', targetType: 'citizen', targetId: pension.citizen_id, metadata: { payPeriod, amount: pension.monthly_amount } });
      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [pension.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Pension paid', message: `Your pension for ${payPeriod} has been paid.`, type: 'Approval' });
      res.status(201).json({ payment: payRows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: `This pension has already been paid for ${payPeriod}.` });
      throw err;
    }
  } catch (err) { next(err); }
}

/** GET /api/pensions/pensioners/:id/payments — officer/admin, or the pensioner themselves. */
async function listPensionPayments(req, res, next) {
  try {
    const { rows: prRows } = await db.query('SELECT citizen_id FROM pension_records WHERE pension_record_id = $1', [req.params.id]);
    if (prRows.length === 0) return res.status(404).json({ error: 'Pension record not found.' });
    const isOfficer = ['pensions_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOfficer && req.user.citizenId !== prRows[0].citizen_id) return res.status(403).json({ error: 'Not authorized.' });
    const { rows } = await db.query('SELECT * FROM pension_payments WHERE pension_record_id = $1 ORDER BY pay_period DESC', [req.params.id]);
    res.json({ payments: rows });
  } catch (err) { next(err); }
}

module.exports = { ...controller, listPensioners, setPensionAmount, payPension, listPensionPayments };
