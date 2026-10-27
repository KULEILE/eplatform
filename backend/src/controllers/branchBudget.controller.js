const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');

const STATUS_FLOW = {
  review: { from: 'Requested', to: 'Under Review' },
  approve: { from: ['Requested', 'Under Review'], to: 'Approved' },
  reject: { from: ['Requested', 'Under Review'], to: 'Rejected' },
  disburse: { from: 'Approved', to: 'Disbursed' },
};

/**
 * POST /api/branch-budget-requests  body: { amount, purpose, justification, fiscalYear }
 * branch_admin only — "head branch administrator where they apply and receive money", for
 * their own office only (req.user.officeId, never taken from the body). Kept separate from the
 * unrelated Budget & Tenders document library (finance_publications).
 */
async function apply(req, res, next) {
  try {
    if (!req.user.officeId) return res.status(400).json({ error: 'Your account has no branch office assigned.' });
    const { amount, purpose, justification, fiscalYear } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'A positive amount is required.' });
    if (!purpose) return res.status(400).json({ error: 'purpose is required.' });
    if (!fiscalYear) return res.status(400).json({ error: 'fiscalYear is required.' });

    const reference = generateReference('BBR');
    const { rows } = await db.query(
      `INSERT INTO branch_budget_requests (reference, office_id, requested_by_user_id, amount, purpose, justification, fiscal_year)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING budget_request_id`,
      [reference, req.user.officeId, req.user.userId, amount, purpose, justification || null, fiscalYear]
    );
    await recordAudit({ userId: req.user.userId, departmentId: null, action: 'BRANCH_BUDGET_REQUEST_SUBMITTED', targetType: 'branch_budget_request', targetId: rows[0].budget_request_id, metadata: { amount, purpose, fiscalYear } });
    res.status(201).json({ recordId: rows[0].budget_request_id, reference, status: 'Requested' });
  } catch (err) { next(err); }
}

/**
 * GET /api/branch-budget-requests
 * branch_admin sees only its own office's requests; finance_officer/system_administrator see
 * every office's requests, since Finance is the approving department.
 */
async function list(req, res, next) {
  try {
    const scopedToOffice = req.user.roleKey === 'branch_admin' ? req.user.officeId : null;
    const { rows } = await db.query(
      `SELECT bbr.*, o.name AS office_name, d.department_key, d.name AS department_name,
              u.email AS requested_by_email
       FROM branch_budget_requests bbr
       JOIN offices o ON o.office_id = bbr.office_id
       JOIN departments d ON d.department_id = o.department_id
       JOIN users u ON u.user_id = bbr.requested_by_user_id
       WHERE $1::int IS NULL OR bbr.office_id = $1
       ORDER BY bbr.created_at DESC`,
      [scopedToOffice]
    );
    res.json({ budgetRequests: rows });
  } catch (err) { next(err); }
}

/** POST /api/branch-budget-requests/:id/:action  action in review|approve|reject|disburse. */
async function transition(req, res, next) {
  try {
    const { action, id } = req.params;
    const flow = STATUS_FLOW[action];
    if (!flow) return res.status(400).json({ error: 'Unknown action.' });
    const { reviewNote } = req.body;
    if (action === 'reject' && !reviewNote) return res.status(400).json({ error: 'reviewNote is required when rejecting.' });

    const { rows } = await db.query('SELECT * FROM branch_budget_requests WHERE budget_request_id = $1', [id]);
    const record = rows[0];
    if (!record) return res.status(404).json({ error: 'Budget request not found.' });
    const allowedFrom = Array.isArray(flow.from) ? flow.from : [flow.from];
    if (!allowedFrom.includes(record.status)) {
      return res.status(409).json({ error: `Cannot ${action} a request with status '${record.status}'.` });
    }

    const sets = ["status = $1", 'updated_at = NOW()'];
    const values = [flow.to];
    if (action === 'review' || action === 'approve' || action === 'reject') {
      sets.push(`reviewed_by_user_id = $${values.length + 1}`); values.push(req.user.userId);
      sets.push(`review_note = $${values.length + 1}`); values.push(reviewNote || null);
      sets.push('reviewed_at = NOW()');
    }
    if (action === 'disburse') {
      sets.push(`disbursed_by_user_id = $${values.length + 1}`); values.push(req.user.userId);
      sets.push('disbursed_at = NOW()');
    }
    values.push(id);
    await db.query(`UPDATE branch_budget_requests SET ${sets.join(', ')} WHERE budget_request_id = $${values.length}`, values);
    await recordAudit({ userId: req.user.userId, departmentId: null, action: `BRANCH_BUDGET_REQUEST_${flow.to.toUpperCase().replace(/ /g, '_')}`, targetType: 'branch_budget_request', targetId: Number(id), metadata: { reviewNote } });

    const { rows: requesterUser } = await db.query('SELECT user_id FROM users WHERE user_id = $1', [record.requested_by_user_id]);
    if (requesterUser[0]) {
      await createNotification({
        userId: requesterUser[0].user_id, title: `Budget request ${flow.to.toLowerCase()}`,
        message: `Reference ${record.reference}${reviewNote ? `: ${reviewNote}` : ''}`,
        type: action === 'reject' ? 'Rejection' : 'Status Change',
      });
    }
    res.json({ success: true, status: flow.to });
  } catch (err) { next(err); }
}

module.exports = { apply, list, transition };
