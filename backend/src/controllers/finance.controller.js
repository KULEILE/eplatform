const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');
const { getDepartmentId } = require('../utils/lookup');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('../utils/notify');

const RETIREMENT_SERVICE_TYPE = 'Government Employee Retirement Declaration';
const SUPPLIER_PAYMENT_SERVICE_TYPE = 'Government Supplier Payment Tracking';
const COMPLAINT_SERVICE_TYPE = 'Finance Complaint or Enquiry';
const EMPLOYEE_CATEGORIES = ['General Civil Servant', 'Uniformed/Disciplined Services'];
const RETIREMENT_REASONS = ['Standard', 'Ill-health', 'Medical Boarding', 'Compulsory Retirement', 'Redundancy', 'Other'];
const CIVIL_SERVICE_PENSION_CLAIM = 'Civil Service Pension Claim';

/** A retirement declaration needs a reason category, a reason-details note when the reason is
 *  'Other', the supporting document (an opaque upload — never parsed for content, same as every
 *  other document in this system), and the citizen must currently be on record as an active
 *  government employee (if Finance has them wrong, that's what the corrections mechanism is
 *  for — see corrections.controller.js — not a path to self-declare retirement). */
async function beforeApply(req) {
  // Government Supplier Payment Tracking: a real invoice, not a bare service type — same reasoning
  // as every other required-field check in this system, enforced server-side so it can't be
  // bypassed by calling the API directly.
  if (req.body.serviceType === SUPPLIER_PAYMENT_SERVICE_TYPE) {
    const { supplierName, invoiceNumber, invoiceAmount } = req.body;
    if (!supplierName || !supplierName.trim()) return { status: 400, error: 'supplierName is required.' };
    if (!invoiceNumber || !invoiceNumber.trim()) return { status: 400, error: 'invoiceNumber is required.' };
    if (invoiceAmount === undefined || invoiceAmount === null || invoiceAmount === '' || Number.isNaN(Number(invoiceAmount)) || Number(invoiceAmount) <= 0) {
      return { status: 400, error: 'invoiceAmount is required and must be a positive number.' };
    }
    return null;
  }

  if (req.body.serviceType === COMPLAINT_SERVICE_TYPE) {
    if (!req.body.complaintText || !req.body.complaintText.trim()) {
      return { status: 400, error: 'complaintText is required.' };
    }
    return null;
  }

  if (req.body.serviceType !== RETIREMENT_SERVICE_TYPE) return null;
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
  // Batch 36 — Supplier Registration Validation and Tax Identity Confirmation removed (bare
  // placeholders with no real logic — see Finance.jsx). Kept out of this allow-list too, so a
  // direct API call can't submit either even though the UI no longer offers them.
  serviceTypes: [
    'Payment Information Update',
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

module.exports = {
  ...controller, lookupGovernmentEmployment, declareGovernmentEmployee,
  retirementTracking, listPublications, createPublication, setPublicationActive,
};
