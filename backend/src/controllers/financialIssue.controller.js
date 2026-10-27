const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { indexApplication, syncApplicationStatus, getDepartmentId } = require('../utils/lookup');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');

/**
 * POST /api/financial-issues  body: { departmentKey, subject, description }
 * Citizen only. This is the single shared "Report a Financial Issue" page — one page with a
 * department dropdown covering every department, instead of a separate tile added to each
 * department's hub (settled design, "to avoid many change"). current_department_id starts
 * equal to department_id and only moves (to Finance) if/when a Department Finance
 * Administrator escalates it — see escalate() below.
 */
async function apply(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to use this service.' });
    const { departmentKey, subject, description } = req.body;
    if (!departmentKey || !subject || !description) {
      return res.status(400).json({ error: 'departmentKey, subject and description are required.' });
    }
    const departmentId = await getDepartmentId(departmentKey).catch(() => null);
    if (!departmentId) return res.status(400).json({ error: 'Unknown departmentKey.' });

    const reference = generateReference('FI');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO financial_issues (reference, citizen_id, department_id, current_department_id, subject, description)
         VALUES ($1,$2,$3,$3,$4,$5) RETURNING financial_issue_id`,
        [reference, req.user.citizenId, departmentId, subject, description]
      );
      const financialIssueId = rows[0].financial_issue_id;
      // Indexed into the same umbrella `applications` table every other department uses, so
      // this shows up in the citizen's existing "My Applications" tracker with no new
      // citizen-facing tracking page needed.
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey, serviceType: 'Financial Issue Report',
        referenceNumber: reference, sourceTable: 'financial_issues', sourceId: financialIssueId, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: 'Financial issue reported',
        message: `Reference ${reference}. It has been sent to the ${departmentKey.replace(/_/g, ' ')} department for review.`,
        type: 'Application Submitted',
      });
      res.status(201).json({ recordId: financialIssueId, reference, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

/**
 * GET /api/financial-issues?status=Submitted
 * department_finance_admin only — the queue for whichever department this administrator is
 * CURRENTLY switched to (req.user.activeDepartmentId). Because escalation simply moves
 * current_department_id to Finance (see escalate() below), switching context to Finance shows
 * exactly the issues other departments escalated, plus any raised against Finance directly —
 * both ends of the flow under this one query, no separate finance_officer involvement.
 */
async function listForAdmin(req, res, next) {
  try {
    if (!req.user.activeDepartmentId) {
      return res.status(400).json({ error: 'Select a department and branch office first.' });
    }
    const { status } = req.query;
    const { rows } = await db.query(
      `SELECT fi.*, c.first_name, c.last_name, c.permanent_identity_number,
              od.department_key AS origin_department_key, od.name AS origin_department_name
       FROM financial_issues fi
       JOIN citizens c ON c.citizen_id = fi.citizen_id
       JOIN departments od ON od.department_id = fi.department_id
       WHERE fi.current_department_id = $1 AND ($2::text IS NULL OR fi.status = $2)
       ORDER BY fi.created_at DESC`,
      [req.user.activeDepartmentId, status || null]
    );
    res.json({ financialIssues: rows });
  } catch (err) { next(err); }
}

/** POST /api/financial-issues/:id/resolve  body: { resolutionNotes } */
async function resolve(req, res, next) {
  try {
    if (!req.user.activeDepartmentId) return res.status(400).json({ error: 'Select a department and branch office first.' });
    const { resolutionNotes } = req.body;
    if (!resolutionNotes) return res.status(400).json({ error: 'resolutionNotes is required.' });

    const { rows } = await db.query('SELECT * FROM financial_issues WHERE financial_issue_id = $1', [req.params.id]);
    const issue = rows[0];
    if (!issue) return res.status(404).json({ error: 'Financial issue not found.' });
    if (issue.current_department_id !== req.user.activeDepartmentId) {
      return res.status(403).json({ error: 'This issue is not in your current department context.' });
    }
    if (issue.status !== 'Submitted') return res.status(409).json({ error: 'This issue has already been resolved.' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE financial_issues SET status = 'Resolved', resolved_by_user_id = $1, resolved_at = NOW(), resolution_notes = $2, updated_at = NOW()
         WHERE financial_issue_id = $3`,
        [req.user.userId, resolutionNotes, issue.financial_issue_id]
      );
      await syncApplicationStatus(client, {
        sourceTable: 'financial_issues', sourceId: issue.financial_issue_id, status: 'Resolved',
        completed: true, changedByUserId: req.user.userId, note: resolutionNotes,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
    await recordAudit({ userId: req.user.userId, departmentId: req.user.activeDepartmentId, action: 'FINANCIAL_ISSUE_RESOLVED', targetType: 'financial_issue', targetId: issue.financial_issue_id });
    const { rows: citizenUser } = await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [issue.citizen_id]);
    if (citizenUser[0]) {
      await createNotification({ userId: citizenUser[0].user_id, title: 'Financial issue resolved', message: `Reference ${issue.reference}: ${resolutionNotes}`, type: 'Status Change' });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

/** POST /api/financial-issues/:id/escalate  body: { escalationNote } */
async function escalate(req, res, next) {
  try {
    if (!req.user.activeDepartmentId) return res.status(400).json({ error: 'Select a department and branch office first.' });
    const { escalationNote } = req.body;

    const { rows } = await db.query('SELECT * FROM financial_issues WHERE financial_issue_id = $1', [req.params.id]);
    const issue = rows[0];
    if (!issue) return res.status(404).json({ error: 'Financial issue not found.' });
    if (issue.current_department_id !== req.user.activeDepartmentId) {
      return res.status(403).json({ error: 'This issue is not in your current department context.' });
    }
    if (issue.status !== 'Submitted') return res.status(409).json({ error: 'This issue has already been resolved.' });

    const financeDepartmentId = await getDepartmentId('finance');
    if (issue.current_department_id === financeDepartmentId) {
      return res.status(409).json({ error: 'This issue is already with Finance.' });
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE financial_issues SET current_department_id = $1, escalated = TRUE, escalated_by_user_id = $2, escalated_at = NOW(), escalation_note = $3, updated_at = NOW()
         WHERE financial_issue_id = $4`,
        [financeDepartmentId, req.user.userId, escalationNote || null, issue.financial_issue_id]
      );
      await syncApplicationStatus(client, {
        sourceTable: 'financial_issues', sourceId: issue.financial_issue_id, status: 'Escalated to Finance',
        completed: false, changedByUserId: req.user.userId, note: escalationNote || 'Escalated to the Finance department.',
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
    await recordAudit({ userId: req.user.userId, departmentId: req.user.activeDepartmentId, action: 'FINANCIAL_ISSUE_ESCALATED', targetType: 'financial_issue', targetId: issue.financial_issue_id, metadata: { escalationNote } });
    const { rows: citizenUser } = await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [issue.citizen_id]);
    if (citizenUser[0]) {
      await createNotification({ userId: citizenUser[0].user_id, title: 'Financial issue escalated to Finance', message: `Reference ${issue.reference} has been forwarded to the Finance department.`, type: 'Status Change' });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = { apply, listForAdmin, resolve, escalate };
