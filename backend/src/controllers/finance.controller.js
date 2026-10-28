const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');
const { getDepartmentId } = require('../utils/lookup');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('../utils/notify');
const { checkDuplicateSubmission } = require('../utils/duplicateSubmissionGuard');

const RETIREMENT_SERVICE_TYPE = 'Government Employee Retirement Declaration';
const SUPPLIER_PAYMENT_SERVICE_TYPE = 'Government Supplier Payment Tracking';
const COMPLAINT_SERVICE_TYPE = 'Finance Complaint or Enquiry';
const PAYMENT_INFO_SERVICE_TYPE = 'Payment Information Update';
const EMPLOYEE_CATEGORIES = ['General Civil Servant', 'Uniformed/Disciplined Services'];
const RETIREMENT_REASONS = ['Standard', 'Ill-health', 'Medical Boarding', 'Compulsory Retirement', 'Redundancy', 'Other'];
const CIVIL_SERVICE_PENSION_CLAIM = 'Civil Service Pension Claim';
const ISSUE_CATEGORIES = ['Salary Issue', 'Bank Details Issue', 'Pension Issue', 'Supplier Payment Issue', 'Tax Issue', 'Other'];
const FINANCE_FINAL_STATUSES = ['Rejected', 'Completed', 'Paid'];

// "the citizen must not allowed to submit many claim unless other one is rejected" — see
// duplicateSubmissionGuard.js for what 'claim' vs 'recurring' means. Government Supplier
// Payment Tracking is deliberately left out of this map: a supplier submits one of these per
// invoice, so many open ones at once over time is normal business, not a duplicate claim.
const FINANCE_DUPLICATE_RULES = {
  [RETIREMENT_SERVICE_TYPE]: 'claim',
  [PAYMENT_INFO_SERVICE_TYPE]: 'recurring',
  'Financial Records Correction': 'recurring',
  [COMPLAINT_SERVICE_TYPE]: 'recurring',
};

/** A retirement declaration needs a reason category, a reason-details note when the reason is
 *  'Other', the supporting document (an opaque upload — never parsed for content, same as every
 *  other document in this system), and the citizen must currently be on record as an active
 *  government employee (if Finance has them wrong, that's what the corrections mechanism is
 *  for — see corrections.controller.js — not a path to self-declare retirement). */
async function beforeApply(req) {
  const serviceType = req.body.serviceType;

  // "the citizen must not allowed to submit many claim unless other one is rejected" — checked
  // up front, before any of the per-type validation below, so it applies uniformly regardless
  // of which service type was picked.
  if (FINANCE_DUPLICATE_RULES[serviceType]) {
    const dupError = await checkDuplicateSubmission({
      table: 'finance_records', citizenId: req.user.citizenId, serviceType,
      mode: FINANCE_DUPLICATE_RULES[serviceType], finalStatuses: FINANCE_FINAL_STATUSES,
    });
    if (dupError) return { status: 409, error: dupError };
  }

  // Government Supplier Payment Tracking: a real invoice, not a bare service type — same reasoning
  // as every other required-field check in this system, enforced server-side so it can't be
  // bypassed by calling the API directly.
  if (serviceType === SUPPLIER_PAYMENT_SERVICE_TYPE) {
    const { supplierName, invoiceNumber, invoiceAmount } = req.body;
    if (!supplierName || !supplierName.trim()) return { status: 400, error: 'supplierName is required.' };
    if (!invoiceNumber || !invoiceNumber.trim()) return { status: 400, error: 'invoiceNumber is required.' };
    if (invoiceAmount === undefined || invoiceAmount === null || invoiceAmount === '' || Number.isNaN(Number(invoiceAmount)) || Number(invoiceAmount) <= 0) {
      return { status: 400, error: 'invoiceAmount is required and must be a positive number.' };
    }
    return null;
  }

  if (serviceType === COMPLAINT_SERVICE_TYPE) {
    if (!req.body.complaintText || !req.body.complaintText.trim()) {
      return { status: 400, error: 'complaintText is required.' };
    }
    // "when citizen have issues must select sub finance eg. health, education and many other" —
    // a category on top of the complaint, not a new department (this system's six departments
    // are fixed). Defaults to 'Other' rather than rejecting, so an older client that doesn't
    // send it yet still works.
    if (req.body.issueCategory && !ISSUE_CATEGORIES.includes(req.body.issueCategory)) {
      return { status: 400, error: `issueCategory must be one of: ${ISSUE_CATEGORIES.join(', ')}` };
    }
    return null;
  }

  // "the citizen must be able to provide their bank details and correct them later if thy
  // change banks" — real, structured bank fields, reviewed by an officer the same way every
  // other official record change in this system is (see afterTransition below, which copies
  // these onto citizens.bank_* only once an officer approves the application).
  if (serviceType === PAYMENT_INFO_SERVICE_TYPE) {
    const { bankName, bankAccountHolderName, bankAccountNumber, bankBranchName } = req.body;
    if (!bankName || !bankName.trim()) return { status: 400, error: 'bankName is required.' };
    if (!bankAccountHolderName || !bankAccountHolderName.trim()) return { status: 400, error: 'bankAccountHolderName is required.' };
    if (!bankAccountNumber || !bankAccountNumber.trim()) return { status: 400, error: 'bankAccountNumber is required.' };
    if (!bankBranchName || !bankBranchName.trim()) return { status: 400, error: 'bankBranchName is required.' };
    return null;
  }

  if (serviceType !== RETIREMENT_SERVICE_TYPE) return null;
  const { retirementReason, retirementReasonDetails, retirementDocumentReference } = req.body;
  if (!RETIREMENT_REASONS.includes(retirementReason)) {
    return { status: 400, error: `retirementReason must be one of: ${RETIREMENT_REASONS.join(', ')}` };
  }
  if (retirementReason === 'Other' && !retirementReasonDetails) {
    return { status: 400, error: "retirementReasonDetails is required when retirementReason is 'Other'." };
  }
  if (!retirementDocumentReference) {
    return { status: 400, error: 'A supporting document (retirement letter/certificate) is required.' };
  }
  const { rows } = await db.query('SELECT government_employment_status FROM citizens WHERE citizen_id = $1', [req.user.citizenId]);
  if (rows.length === 0 || rows[0].government_employment_status !== 'Active') {
    return {
      status: 409,
      error: 'Our records do not show you as an active government employee, so there is nothing to retire from. If this is incorrect, please submit a correction request.',
    };
  }
  return null;
}

/** On approval ('Completed') of a retirement declaration, the citizen's employment record moves
 *  to Retired — this is what actually grants Civil Service Pension eligibility later (see
 *  pensions.controller.js), never the declaration's submission itself. */
async function afterTransition(client, record, toStatus, req) {
  if (record.service_type === RETIREMENT_SERVICE_TYPE && toStatus === 'Completed') {
    await client.query(
      `UPDATE citizens SET government_employment_status = 'Retired', retirement_reason = $1, retirement_reason_details = $2, updated_at = NOW() WHERE citizen_id = $3`,
      [record.retirement_reason, record.retirement_reason_details, record.citizen_id]
    );
    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('finance'), action: 'GOVERNMENT_EMPLOYEE_RETIRED',
      targetType: 'citizen', targetId: record.citizen_id, reason: record.retirement_reason,
    });
    return;
  }

  // On approval of a Payment Information Update, what the citizen submitted on this
  // application becomes what is actually on file for paying them — never before an officer has
  // reviewed it (see the required-field checks in beforeApply above).
  if (record.service_type === PAYMENT_INFO_SERVICE_TYPE && toStatus === 'Completed') {
    await client.query(
      `UPDATE citizens SET bank_name = $1, bank_account_holder_name = $2, bank_account_number = $3, bank_branch_name = $4, bank_details_updated_at = NOW(), updated_at = NOW() WHERE citizen_id = $5`,
      [record.bank_name, record.bank_account_holder_name, record.bank_account_number, record.bank_branch_name, record.citizen_id]
    );
    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('finance'), action: 'CITIZEN_BANK_DETAILS_UPDATED',
      targetType: 'citizen', targetId: record.citizen_id,
    });
  }
}

const controller = makeDepartmentController({
  table: 'finance_records',
  idColumn: 'finance_record_id',
  deptKey: 'finance',
  officerRoleKey: 'finance_officer',
  refPrefix: 'FIN',
  // Batch 36 — Supplier Registration Validation and Tax Identity Confirmation removed (bare
  // placeholders with no real logic — see Finance.jsx). Kept out of this allow-list too, so a
  // direct API call can't submit either even though the UI no longer offers them.
  serviceTypes: [
    PAYMENT_INFO_SERVICE_TYPE,
    'Financial Records Correction', RETIREMENT_SERVICE_TYPE, SUPPLIER_PAYMENT_SERVICE_TYPE, COMPLAINT_SERVICE_TYPE,
  ],
  extraInsertFields: [
    { column: 'retirement_reason', fromBody: 'retirementReason' },
    { column: 'retirement_reason_details', fromBody: 'retirementReasonDetails' },
    { column: 'retirement_document_reference', fromBody: 'retirementDocumentReference' },
    { column: 'supplier_name', fromBody: 'supplierName' },
    { column: 'invoice_number', fromBody: 'invoiceNumber' },
    { column: 'invoice_amount', fromBody: 'invoiceAmount' },
    { column: 'invoice_date', fromBody: 'invoiceDate' },
    { column: 'evidence_reference', fromBody: 'evidenceReference' },
    { column: 'complaint_text', fromBody: 'complaintText' },
    { column: 'issue_category', fromBody: 'issueCategory' },
    { column: 'bank_name', fromBody: 'bankName' },
    { column: 'bank_account_holder_name', fromBody: 'bankAccountHolderName' },
    { column: 'bank_account_number', fromBody: 'bankAccountNumber' },
    { column: 'bank_branch_name', fromBody: 'bankBranchName' },
  ],
  finalStatuses: FINANCE_FINAL_STATUSES,
  beforeApply,
  afterTransition,
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'verify-identity': { from: 'Under Review', to: 'Identity Verified' },
    'check-documents': { from: 'Identity Verified', to: 'Documents Checked' },
    'process': { from: 'Documents Checked', to: 'Processing' },
    'complete': {
      from: 'Processing', to: 'Completed',
      extra: (record) => record.service_type === RETIREMENT_SERVICE_TYPE
        ? null
        : { setSql: `validated_information_note = $3`, params: ['Identity and supporting information validated against Home Affairs and departmental records.'] },
    },
    // Government Supplier Payment Tracking's own, simpler flow: Submitted -> Under Review ->
    // Approved -> Paid. Guarded by service_type so these two actions can't be used to push a
    // record of any other Finance service type through 'Approved'/'Paid', which would be
    // meaningless for a Tax Identity Confirmation or a correction.
    'approve-payment': {
      from: 'Under Review', to: 'Approved',
      extra: (record) => record.service_type !== SUPPLIER_PAYMENT_SERVICE_TYPE
        ? { error: 'This action only applies to Government Supplier Payment Tracking.' }
        : null,
    },
    'mark-paid': {
      from: 'Approved', to: 'Paid',
      extra: (record) => record.service_type !== SUPPLIER_PAYMENT_SERVICE_TYPE
        ? { error: 'This action only applies to Government Supplier Payment Tracking.' }
        : null,
    },
    // Finance Complaint or Enquiry: answered directly from 'Under Review', same reasoning as
    // Pensions' 'respond-enquiry' — there's nothing to process, it's a complaint or a question,
    // and the officer's written response is the actual deliverable, not a bare status change.
    'respond-complaint': {
      from: 'Under Review', to: 'Completed',
      extra: (record, req) => {
        if (record.service_type !== COMPLAINT_SERVICE_TYPE) {
          return { error: 'This action only applies to a Finance Complaint or Enquiry.' };
        }
        if (!req.body.officerResponse || !req.body.officerResponse.trim()) {
          return { error: 'officerResponse is required.' };
        }
        return { setSql: 'officer_response = $3', params: [req.body.officerResponse.trim()] };
      },
    },
  },
});

// ============================================================================================
// GOVERNMENT EMPLOYMENT RECORD — Finance, as the department that funds every other department's
// payroll, is the authority on who is currently an active government employee. These two actions
// are deliberately NOT part of the application workflow above: declaring someone an employee is
// an officer-initiated record action, not a citizen application, and both only ever act on one
// specific citizen looked up by identity number — never a browsable directory of everyone.
// ============================================================================================

/** GET /api/finance/government-employment/:permanentIdentityNumber — officer only. */
async function lookupGovernmentEmployment(req, res, next) {
  try {
    if (!['finance_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { rows } = await db.query(
      `SELECT citizen_id, first_name, last_name, permanent_identity_number,
              government_employment_status, employee_category, retirement_reason, retirement_reason_details
       FROM citizens WHERE permanent_identity_number = $1`,
      [req.params.permanentIdentityNumber]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No citizen record matches that permanent identity number.' });
    res.json({ citizen: rows[0] });
  } catch (err) { next(err); }
}

/** POST /api/finance/government-employment/declare  body: { permanentIdentityNumber, employeeCategory }
 *  Officer only. Marks a citizen as an active government employee — the "hiring" side; retiring
 *  only ever happens through the citizen's own retirement declaration above, approved by an
 *  officer, never through this direct action. */
async function declareGovernmentEmployee(req, res, next) {
  try {
    if (!['finance_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { permanentIdentityNumber, employeeCategory } = req.body;
    if (!EMPLOYEE_CATEGORIES.includes(employeeCategory)) {
      return res.status(400).json({ error: `employeeCategory must be one of: ${EMPLOYEE_CATEGORIES.join(', ')}` });
    }
    const { rows } = await db.query('SELECT citizen_id, government_employment_status FROM citizens WHERE permanent_identity_number = $1', [permanentIdentityNumber]);
    if (rows.length === 0) return res.status(404).json({ error: 'No citizen record matches that permanent identity number.' });
    if (rows[0].government_employment_status === 'Active') {
      return res.status(409).json({ error: 'This citizen is already recorded as an active government employee.' });
    }
    await db.query(
      `UPDATE citizens SET government_employment_status = 'Active', employee_category = $1, retirement_reason = NULL, retirement_reason_details = NULL, updated_at = NOW() WHERE citizen_id = $2`,
      [employeeCategory, rows[0].citizen_id]
    );
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('finance'), action: 'GOVERNMENT_EMPLOYEE_DECLARED', targetType: 'citizen', targetId: rows[0].citizen_id, reason: employeeCategory });
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [rows[0].citizen_id])).rows[0];
    if (userRow) {
      await createNotification({ userId: userRow.user_id, title: 'Government employment recorded', message: `You have been recorded as an active government employee (${employeeCategory}). If this is incorrect, please submit a correction request.`, type: 'System' });
    }
    res.json({ citizenId: rows[0].citizen_id, governmentEmploymentStatus: 'Active', employeeCategory });
  } catch (err) { next(err); }
}

// ============================================================================================
// RETIREMENT BENEFITS TRACKING — service #2: "Retiring civil servants track whether their
// pension or gratuity documents have been received and processed." Before this, a retiring
// civil servant's retirement declaration (finance_records) and their Civil Service Pension
// Claim (a completely different table, owned by a completely different department) were two
// unrelated records in two separate officer queues, with no single place for the citizen to see
// both at once. This is a read-only combined view across both — it creates nothing new, it just
// answers "where do things stand" in one place instead of two.
// ============================================================================================

/** GET /api/finance/retirement-tracking — citizen's own retirement declaration (if any) and
 *  Civil Service Pension Claim (if any), together. Either may be null — a citizen may have
 *  declared retirement but not yet claimed the pension, or (in theory) have neither yet. */
async function retirementTracking(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required.' });
    const [{ rows: declarationRows }, { rows: claimRows }] = await Promise.all([
      db.query(
        `SELECT finance_record_id, application_reference, status, retirement_reason, retirement_reason_details, created_at, updated_at
         FROM finance_records WHERE citizen_id = $1 AND service_type = $2 ORDER BY created_at DESC LIMIT 1`,
        [req.user.citizenId, RETIREMENT_SERVICE_TYPE]
      ),
      db.query(
        `SELECT pension_record_id, application_reference, status, created_at, updated_at
         FROM pension_records WHERE citizen_id = $1 AND service_type = $2 ORDER BY created_at DESC LIMIT 1`,
        [req.user.citizenId, CIVIL_SERVICE_PENSION_CLAIM]
      ),
    ]);
    res.json({
      retirementDeclaration: declarationRows[0] || null,
      pensionClaim: claimRows[0] || null,
    });
  } catch (err) { next(err); }
}

// ============================================================================================
// BUDGET AND TENDER INFORMATION — service #5. A real document library: a Finance officer or
// admin publishes a budget document or tender announcement (with the actual file uploaded via
// POST /api/uploads/publication — see uploads.controller.js), and any authenticated citizen or
// business can list and download them. Deactivating a publication (rather than deleting it)
// keeps the file and its record intact — e.g. a past fiscal year's budget stays available for
// reference — while taking it out of the default citizen-facing listing.
// ============================================================================================

const PUBLICATION_TYPES = ['Budget Document', 'Tender Announcement'];

/** GET /api/finance/publications?type=Budget Document|Tender Announcement&includeInactive=true
 *  Any authenticated user. includeInactive is honoured only for an officer/admin — a citizen
 *  only ever sees active publications. */
async function listPublications(req, res, next) {
  try {
    const { type } = req.query;
    if (type && !PUBLICATION_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${PUBLICATION_TYPES.join(', ')}` });
    }
    const isOfficer = ['finance_officer', 'system_administrator'].includes(req.user.roleKey);
    const includeInactive = isOfficer && req.query.includeInactive === 'true';
    const { rows } = await db.query(
      `SELECT p.*, u.email AS published_by_email FROM finance_publications p
       LEFT JOIN users u ON u.user_id = p.published_by_user_id
       WHERE ($1::text IS NULL OR p.publication_type = $1) AND ($2::boolean OR p.is_active = TRUE)
       ORDER BY p.publication_type, COALESCE(p.tender_deadline, p.created_at::date) DESC, p.created_at DESC`,
      [type || null, includeInactive]
    );
    res.json({ publications: rows });
  } catch (err) { next(err); }
}

/** POST /api/finance/publications — officer/admin only.
 *  body: { publicationType, title, description?, fiscalYear?, tenderDeadline?, fileReference, originalFilename? } */
async function createPublication(req, res, next) {
  try {
    if (!['finance_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { publicationType, title, description, fiscalYear, tenderDeadline, fileReference, originalFilename } = req.body;
    if (!PUBLICATION_TYPES.includes(publicationType)) {
      return res.status(400).json({ error: `publicationType must be one of: ${PUBLICATION_TYPES.join(', ')}` });
    }
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required.' });
    if (!fileReference) return res.status(400).json({ error: 'fileReference is required — upload the document first via POST /api/uploads/publication.' });
    const { rows } = await db.query(
      `INSERT INTO finance_publications (publication_type, title, description, fiscal_year, tender_deadline, file_reference, original_filename, published_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [publicationType, title.trim(), description || null, fiscalYear || null, tenderDeadline || null, fileReference, originalFilename || null, req.user.userId]
    );
    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('finance'), action: 'FINANCE_PUBLICATION_CREATED',
      targetType: 'finance_publication', targetId: rows[0].publication_id, reason: title.trim(),
    });
    res.status(201).json({ publication: rows[0] });
  } catch (err) { next(err); }
}

/** PATCH /api/finance/publications/:id/active — officer/admin only. body: { isActive } */
async function setPublicationActive(req, res, next) {
  try {
    if (!['finance_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { isActive } = req.body;
    const { rows } = await db.query(
      `UPDATE finance_publications SET is_active = $1, updated_at = NOW() WHERE publication_id = $2 RETURNING *`,
      [!!isActive, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Publication not found.' });
    res.json({ publication: rows[0] });
  } catch (err) { next(err); }
}

// ============================================================================================
// EMPLOYEE ROSTER AND PAYROLL — "it must show all employee and those who are still alive and
// those who are dead and finance department should pay this employee." Unlike
// lookupGovernmentEmployment above (one citizen at a time, by design — see its own comment),
// this IS a browsable roster, deliberately: it is the citizen's own explicit, repeated request
// for "a full real system", confirmed after I flagged the reversal. It lists every officer/
// admin ACCOUNT (users.role_key != 'citizen'), not only citizens who happen to have applied for
// something, which is also why an account with no linked citizen identity still shows up here
// (flagged, not hidden) — see migration 080's note #5 on why most officer accounts start out
// this way and admin.controller.js's linkEmployeeCitizen for how a system administrator fixes
// that for an existing account.
// ============================================================================================

const EMPLOYEE_ROLES_CLAUSE = `r.role_key != 'citizen'`;

/** GET /api/finance/employees — officer/admin only. */
async function listEmployees(req, res, next) {
  try {
    if (!['finance_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { rows } = await db.query(
      `SELECT u.user_id, u.username, u.email, u.account_status, r.role_key, r.display_name AS role_name,
              d.name AS department_name, o.name AS office_name,
              c.citizen_id, c.first_name, c.last_name, c.permanent_identity_number, c.is_deceased,
              c.government_employment_status, c.employee_category, c.monthly_salary,
              c.bank_name, c.bank_account_holder_name, c.bank_account_number, c.bank_branch_name
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.department_id = u.department_id
       LEFT JOIN offices o ON o.office_id = u.office_id
       LEFT JOIN citizens c ON c.citizen_id = u.citizen_id
       WHERE ${EMPLOYEE_ROLES_CLAUSE}
       ORDER BY (c.citizen_id IS NULL), c.government_employment_status = 'Active' DESC, u.created_at DESC`
    );
    res.json({ employees: rows });
  } catch (err) { next(err); }
}

/** PATCH /api/finance/employees/:citizenId/salary  body: { monthlySalary } — officer/admin
 *  only. Only settable for a currently active employee — matches declareGovernmentEmployee's
 *  own "employment status is the gate" reasoning above. */
async function setEmployeeSalary(req, res, next) {
  try {
    if (!['finance_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { monthlySalary } = req.body;
    if (monthlySalary === undefined || monthlySalary === null || monthlySalary === '' || Number.isNaN(Number(monthlySalary)) || Number(monthlySalary) < 0) {
      return res.status(400).json({ error: 'monthlySalary is required and must be zero or a positive number.' });
    }
    const { rows } = await db.query('SELECT government_employment_status FROM citizens WHERE citizen_id = $1', [req.params.citizenId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Citizen record not found.' });
    if (rows[0].government_employment_status !== 'Active') {
      return res.status(409).json({ error: 'A salary can only be set for an active government employee.' });
    }
    await db.query('UPDATE citizens SET monthly_salary = $1, updated_at = NOW() WHERE citizen_id = $2', [monthlySalary, req.params.citizenId]);
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('finance'), action: 'EMPLOYEE_SALARY_SET', targetType: 'citizen', targetId: req.params.citizenId, metadata: { monthlySalary } });
    res.json({ citizenId: Number(req.params.citizenId), monthlySalary: Number(monthlySalary) });
  } catch (err) { next(err); }
}

/** POST /api/finance/employees/:citizenId/pay  body: { payPeriod: 'YYYY-MM', reference? }
 *  officer/admin only. A real (simulated) payment event — amount comes from citizens.
 *  monthly_salary, never from the request body, so Finance can't be asked to pay an arbitrary
 *  figure that doesn't match what was actually set on record. */
async function paySalary(req, res, next) {
  try {
    if (!['finance_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { payPeriod, reference } = req.body;
    if (!/^\d{4}-\d{2}$/.test(payPeriod || '')) return res.status(400).json({ error: "payPeriod is required, in 'YYYY-MM' format." });
    const { rows } = await db.query('SELECT citizen_id, government_employment_status, monthly_salary FROM citizens WHERE citizen_id = $1', [req.params.citizenId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Citizen record not found.' });
    const citizen = rows[0];
    if (citizen.government_employment_status !== 'Active') return res.status(409).json({ error: 'Only an active government employee can be paid.' });
    if (!citizen.monthly_salary) return res.status(409).json({ error: 'Set a monthly salary for this employee before recording a payment.' });
    try {
      const { rows: payRows } = await db.query(
        `INSERT INTO salary_payments (citizen_id, pay_period, amount, reference, paid_by_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [citizen.citizen_id, payPeriod, citizen.monthly_salary, reference || null, req.user.userId]
      );
      await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('finance'), action: 'SALARY_PAID', targetType: 'citizen', targetId: citizen.citizen_id, metadata: { payPeriod, amount: citizen.monthly_salary } });
      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [citizen.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Salary paid', message: `Your salary for ${payPeriod} has been paid.`, type: 'Approval' });
      res.status(201).json({ payment: payRows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: `This employee has already been paid for ${payPeriod}.` });
      throw err;
    }
  } catch (err) { next(err); }
}

/** GET /api/finance/employees/:citizenId/payments — officer/admin, or the employee themselves. */
async function listSalaryPayments(req, res, next) {
  try {
    const isOfficer = ['finance_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOfficer && req.user.citizenId !== Number(req.params.citizenId)) return res.status(403).json({ error: 'Not authorized.' });
    const { rows } = await db.query('SELECT * FROM salary_payments WHERE citizen_id = $1 ORDER BY pay_period DESC', [req.params.citizenId]);
    res.json({ payments: rows });
  } catch (err) { next(err); }
}

module.exports = {
  ...controller, lookupGovernmentEmployment, declareGovernmentEmployee,
  retirementTracking, listPublications, createPublication, setPublicationActive,
  listEmployees, setEmployeeSalary, paySalary, listSalaryPayments,
};
