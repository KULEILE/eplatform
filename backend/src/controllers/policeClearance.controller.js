const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');
const { recordAudit } = require('../utils/audit');
const { getDepartmentId } = require('../utils/lookup');
const { getCaseHistoryForCitizen, computeSuggestedClearanceResult } = require('../utils/policeHistory');

// ============================================================================================
// POLICE CLEARANCE CERTIFICATE
//
// A citizen-facing self-service request — deliberately separate from the police_records table,
// which is the officer-initiated, purpose-bound identity-verification lookup tool used for
// investigations (see police.controller.js). Built on the same generic department-service
// factory as Traffic/Finance/Pensions, plus a certificate-generation step and a certificate
// view, the same pattern Home Affairs uses for birth certificates and National ID cards.
// ============================================================================================

const base = makeDepartmentController({
  table: 'police_clearance_requests',
  idColumn: 'clearance_record_id',
  deptKey: 'police',
  officerRoleKey: 'police_officer',
  refPrefix: 'PCC',
  serviceTypes: ['Police Clearance Certificate'],
  extraInsertFields: [
    { column: 'purpose', fromBody: 'purpose' },
    { column: 'preferred_office_id', fromBody: 'preferredOfficeId' },
  ],
  finalStatuses: ['Rejected', 'Collected'],
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'begin-background-check': { from: 'Under Review', to: 'Background Check In Progress' },
    'approve': {
      from: 'Background Check In Progress', to: 'Approved',
      // Async (see simpleDepartmentController.js's transition(), which now awaits this): when
      // the officer's request doesn't explicitly say clearanceResult, this computes the REAL
      // suggested verdict from the applicant's actual case/arrest/sentence history (see
      // policeHistory.js) instead of silently defaulting to 'Clean Record' regardless of what's
      // on file. When the officer's request DOES say clearanceResult (the normal path — see
      // GET .../history below, which the officer reviews before approving, and
      // PoliceClearanceList.jsx, which pre-fills the approve form with that same suggestion), that
      // explicit choice always wins — this is the one-and-only override point, same as before.
      extra: async (record, req) => {
        const clearanceResult = req.body.clearanceResult === 'Record Found' || req.body.clearanceResult === 'Clean Record'
          ? req.body.clearanceResult
          : await computeSuggestedClearanceResult(record.citizen_id);
        const certificateNumber = 'PCC-' + String(Math.floor(100000 + Math.random() * 900000));
        return {
          setSql: `certificate_number = $3, issue_date = CURRENT_DATE, clearance_result = $4::varchar, officer_notes = $5`,
          params: [certificateNumber, clearanceResult, req.body.officerNotes || null],
        };
      },
    },
    'ready-for-collection': { from: 'Approved', to: 'Ready for Collection' },
    // Collection (Feature 3): the citizen signs on a pad at the counter before the officer can
    // mark the certificate collected — see database/migrations/035_add_signature_reference.sql.
    'collect': {
      from: 'Ready for Collection', to: 'Collected',
      extra: (record, req) => {
        if (!req.body.signatureReference) {
          return { error: 'The citizen\'s signature is required before the certificate can be marked collected.' };
        }
        return { setSql: 'signature_reference = $3', params: [req.body.signatureReference] };
      },
    },
  },
});

/** POST /api/police/clearance/:id/resubmit (citizen, owner only) — Feature 4: lets the citizen
 *  correct and resubmit after Additional Information Required or Rejected, instead of starting
 *  a new application. Built from scratch — police clearance had no resubmit concept before this
 *  (it only ever had the generic officer-side transitions from simpleDepartmentController). */
async function resubmit(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required.' });
    const { purpose, preferredOfficeId } = req.body;
    if (!purpose) return res.status(400).json({ error: 'purpose is required.' });
    if (!preferredOfficeId) return res.status(400).json({ error: 'preferredOfficeId is required.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM police_clearance_requests WHERE clearance_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
      const record = rows[0];
      if (record.citizen_id !== req.user.citizenId) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your application.' }); }
      if (!['Additional Information Required', 'Rejected'].includes(record.status)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot resubmit from '${record.status}'.` });
      }
      await client.query(
        `UPDATE police_clearance_requests SET status = 'Under Review', rejection_reason = NULL,
            purpose = $1, preferred_office_id = $2, updated_at = NOW()
         WHERE clearance_record_id = $3`,
        [purpose, preferredOfficeId, record.clearance_record_id]
      );
      await client.query('COMMIT');
      res.json({ recordId: record.clearance_record_id, status: 'Under Review' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

/** GET /api/police/clearance/:id/history — officer-only. Shows the applicant's full
 *  case/arrest/sentence history (see policeHistory.js) alongside an auto-suggested clearance
 *  verdict, so the officer reviewing the application can make an informed decision before
 *  approving — and, per the explicit instruction behind this feature, can always override that
 *  suggestion either way. The suggestion itself is computed only from actual convictions, never
 *  from a mere open case or arrest — see computeSuggestedClearanceResult's own doc comment. */
async function getHistory(req, res, next) {
  try {
    if (!['police_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { rows } = await db.query('SELECT clearance_record_id, citizen_id FROM police_clearance_requests WHERE clearance_record_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    const [history, suggestedClearanceResult] = await Promise.all([
      getCaseHistoryForCitizen(rows[0].citizen_id),
      computeSuggestedClearanceResult(rows[0].citizen_id),
    ]);
    res.json({ history, suggestedClearanceResult });
  } catch (err) { next(err); }
}

/** GET /api/police/clearance/:id/certificate — the formatted, printable certificate. */
async function getCertificate(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT pcr.*, c.first_name, c.last_name, c.date_of_birth, c.sex, c.permanent_identity_number,
              o.name AS office_name, dist.name AS office_district
       FROM police_clearance_requests pcr
       JOIN citizens c ON c.citizen_id = pcr.citizen_id
       LEFT JOIN offices o ON o.office_id = pcr.preferred_office_id
       LEFT JOIN districts dist ON dist.district_id = o.district_id
       WHERE pcr.clearance_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    const record = rows[0];
    if (!['Approved', 'Ready for Collection', 'Collected'].includes(record.status)) {
      return res.status(409).json({ error: 'This certificate has not been issued yet.' });
    }
    const isOwner = req.user.citizenId && req.user.citizenId === record.citizen_id;
    const isOfficer = ['police_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this certificate.' });

    if (isOwner) {
      await recordAudit({
        userId: req.user.userId, departmentId: await getDepartmentId('police'), action: 'POLICE_CLEARANCE_CERTIFICATE_VIEWED',
        targetType: 'police_clearance_request', targetId: record.clearance_record_id,
      });
    }
    res.json({ clearance: record });
  } catch (err) { next(err); }
}

module.exports = { ...base, getCertificate, resubmit, getHistory };
