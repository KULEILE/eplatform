const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');
const { getDepartmentId } = require('../utils/lookup');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('../utils/notify');
const { makeRespondHandler } = require('../utils/respondToEnquiry');

const RETIREMENT_SERVICE_TYPE = 'Government Employee Retirement Declaration';
const SUPPLIER_PAYMENT_SERVICE_TYPE = 'Government Supplier Payment Tracking';
const COMPLAINT_SERVICE_TYPE = 'Finance Complaint or Enquiry';
const EMPLOYEE_CATEGORIES = ['General Civil Servant', 'Uniformed/Disciplined Services'];
const RETIREMENT_REASONS = ['Standard', 'Ill-health', 'Medical Boarding', 'Compulsory Retirement', 'Redundancy', 'Other'];

/** A retirement declaration needs a reason category, a reason-details note when the reason is
 *  'Other', the supporting document (an opaque upload — never parsed for content, same as every
 *  other document in this system), and the citizen must currently be on record as an active
 *  government employee (if Finance has them wrong, that's what the corrections mechanism is
 *  for — see corrections.controller.js — not a path to self-declare retirement). */
async function beforeApply(req) {
  const { serviceType } = req.body;

  // Supplier payment tracking: the invoice details are what the officer checks and pays against.
  if (serviceType === SUPPLIER_PAYMENT_SERVICE_TYPE) {
    const { supplierName, invoiceNumber, invoiceAmount, invoiceDate } = req.body;
    if (!supplierName || !String(supplierName).trim()) return { status: 400, error: 'Supplier/business name is required.' };
    if (!invoiceNumber || !String(invoiceNumber).trim()) return { status: 400, error: 'Invoice number is required.' };
    const amount = Number(invoiceAmount);
    if (!Number.isFinite(amount) || amount <= 0) return { status: 400, error: 'Invoice amount must be a number greater than 0.' };
    if (!invoiceDate || Number.isNaN(Date.parse(invoiceDate))) return { status: 400, error: 'A valid invoice date is required.' };
    if (new Date(invoiceDate) > new Date()) return { status: 400, error: 'Invoice date cannot be in the future.' };
    return null;
  }

  // Complaint or enquiry: just needs the citizen's actual text.
  if (serviceType === COMPLAINT_SERVICE_TYPE) {
    if (!req.body.complaintText || !String(req.body.complaintText).trim()) {
      return { status: 400, error: 'Please describe your complaint or enquiry.' };
    }
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
  if (record.service_type !== RETIREMENT_SERVICE_TYPE || toStatus !== 'Completed') return;
  await client.query(
    `UPDATE citizens SET government_employment_status = 'Retired', retirement_reason = $1, retirement_reason_details = $2, updated_at = NOW() WHERE citizen_id = $3`,
    [record.retirement_reason, record.retirement_reason_details, record.citizen_id]
  );
  await recordAudit({
    userId: req.user.userId, departmentId: await getDepartmentId('finance'), action: 'GOVERNMENT_EMPLOYEE_RETIRED',
    targetType: 'citizen', targetId: record.citizen_id, reason: record.retirement_reason,
  });
}

const controller = makeDepartmentController({
  table: 'finance_records',
  idColumn: 'finance_record_id',
  deptKey: 'finance',
  officerRoleKey: 'finance_officer',
  refPrefix: 'FIN',
  serviceTypes: [
    'Supplier Registration Validation', 'Payment Information Update', 'Tax Identity Confirmation', 'Financial Records Correction',
    RETIREMENT_SERVICE_TYPE, SUPPLIER_PAYMENT_SERVICE_TYPE, COMPLAINT_SERVICE_TYPE,
  ],
  extraInsertFields: [
    { column: 'retirement_reason', fromBody: 'retirementReason' },
    { column: 'retirement_reason_details', fromBody: 'retirementReasonDetails' },
    { column: 'retirement_document_reference', fromBody: 'retirementDocumentReference' },
    { column: 'supplier_name', fromBody: 'supplierName' },
    { column: 'invoice_number', fromBody: 'invoiceNumber' },
    { column: 'invoice_amount', fromBody: 'invoiceAmount' },
    { column: 'invoice_date', fromBody: 'invoiceDate' },
    { column: 'complaint_text', fromBody: 'complaintText' },
    { column: 'evidence_reference', fromBody: 'evidenceReference' },
  ],
  finalStatuses: ['Rejected', 'Completed', 'Paid'],
  beforeApply,
  afterTransition,
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'verify-identity': { from: 'Under Review', to: 'Identity Verified' },
    'check-documents': { from: 'Identity Verified', to: 'Documents Checked' },
    'process': { from: 'Documents Checked', to: 'Processing' },
    'complete': {
      from: 'Processing', to: 'Completed',
      extra: (record) => {
        if (record.service_type === SUPPLIER_PAYMENT_SERVICE_TYPE) return { error: "A supplier payment is finished with 'Mark as paid', not 'Completed'." };
        if (record.service_type === COMPLAINT_SERVICE_TYPE) return { error: 'A complaint or enquiry is finished by responding to it.' };
        return record.service_type === RETIREMENT_SERVICE_TYPE
          ? null
          : { setSql: `validated_information_note = $3`, params: ['Identity and supporting information validated against Home Affairs and departmental records.'] };
      },
    },
    // Supplier payments only: the invoice has been paid out.
    'mark-paid': {
      from: 'Processing', to: 'Paid',
      extra: (record) => record.service_type === SUPPLIER_PAYMENT_SERVICE_TYPE
        ? { setSql: 'paid_at = NOW()', params: [] }
        : { error: "Only a supplier payment can be marked as paid." },
    },
  },
});

// POST /api/finance/:id/respond — officer answers a complaint/enquiry (see utils/respondToEnquiry.js).
const respond = makeRespondHandler({
  table: 'finance_records', idColumn: 'finance_record_id', officerRoleKey: 'finance_officer', serviceType: COMPLAINT_SERVICE_TYPE,
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

/** A supplier payment marked 'Paid' is finished — the shared factory's reject/request-information
 *  only block 'Rejected'/'Completed'/'Collected', so guard 'Paid' here without touching the
 *  factory (which Traffic and Police also use). */
function blockIfPaid(handler) {
  return async (req, res, next) => {
    try {
      const { rows } = await db.query('SELECT status FROM finance_records WHERE finance_record_id = $1', [req.params.id]);
      if (rows[0]?.status === 'Paid') return res.status(409).json({ error: 'This supplier payment has already been paid.' });
      return handler(req, res, next);
    } catch (err) { next(err); }
  };
}

module.exports = {
  ...controller,
  reject: blockIfPaid(controller.reject),
  requestInformation: blockIfPaid(controller.requestInformation),
  respond,
  lookupGovernmentEmployment,
  declareGovernmentEmployee,
};
