const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');
const { recordAudit } = require('../utils/audit');
const { getDepartmentId, indexApplication } = require('../utils/lookup');
const { generateReference } = require('../utils/referenceGenerator');
const { createNotification } = require('../utils/notify');
const { getCaseHistoryForCitizen, computeSuggestedClearanceResult } = require('../utils/policeHistory');

// ============================================================================================
// POLICE CLEARANCE CERTIFICATE
//
// A citizen-facing self-service request — deliberately separate from the police_records table,
// which is the officer-initiated, purpose-bound identity-verification lookup tool used for
// investigations (see police.controller.js). Built on the same generic department-service
// factory as Traffic/Finance/Pensions, plus a certificate-generation step and a certificate
// view, the same pattern Home Affairs uses for birth certificates and National ID cards.
//
// Batch 34 — "the system automatically generate police clearance": applying for a certificate
// used to start a 5-step officer-driven chain (start-review -> begin-background-check ->
// approve -> ready-for-collection -> collect) before anything was issued. Per the explicit,
// settled instruction behind this change, a NEW application now skips straight to a finished,
// Ready for Collection certificate the moment it's submitted — see the custom apply() below,
// which replaces base.apply entirely rather than reusing simpleDepartmentController's version
// (that factory has no "insert already at a later status" hook). The computation itself
// (computeSuggestedClearanceResult, certificate number) is exactly the same logic the old
// 'approve' transition's extra() already used — only WHEN it runs has changed, not what it
// computes. The 'start-review'/'begin-background-check'/'approve' transitions below are left in
// statusFlow untouched (not removed) purely so any record that already existed in an earlier
// status before this batch can still be walked through to completion by an officer; no new
// application will ever reach those statuses again. 'ready-for-collection' and 'collect'
// (signature capture) are unaffected either way.
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

/** POST /api/police/clearance/apply — Batch 34: a NEW application is issued automatically and
 *  immediately, with no officer step at all. Computes the same real suggested verdict
 *  (computeSuggestedClearanceResult) and generates a certificate number the same way the old
 *  'approve' transition did, but does it at the moment of applying rather than waiting for an
 *  officer to click through a review chain. The record is inserted directly at 'Ready for
 *  Collection' — the only remaining step is the citizen physically collecting the printed
 *  certificate and signing for it (see policeClearance's existing 'collect' transition /
 *  PoliceClearanceCertificate.jsx), which was never an officer *review* step, just a
 *  physical-counter signature capture, so it's unaffected by removing the review chain. */
async function apply(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to use this service.' });
    const { serviceType, purpose, preferredOfficeId } = req.body;
    if (serviceType !== 'Police Clearance Certificate') {
      return res.status(400).json({ error: 'serviceType must be one of: Police Clearance Certificate' });
    }
    const referenceNumber = generateReference('PCC');
    const clearanceResult = await computeSuggestedClearanceResult(req.user.citizenId);
    const certificateNumber = 'PCC-' + String(Math.floor(100000 + Math.random() * 900000));
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO police_clearance_requests
           (citizen_id, application_reference, service_type, purpose, preferred_office_id,
            status, certificate_number, issue_date, clearance_result)
         VALUES ($1,$2,$3,$4,$5,'Ready for Collection',$6,CURRENT_DATE,$7)
         RETURNING clearance_record_id`,
        [req.user.citizenId, referenceNumber, serviceType, purpose || null, preferredOfficeId || null, certificateNumber, clearanceResult]
      );
      const recordId = rows[0].clearance_record_id;
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'police', serviceType, referenceNumber,
        sourceTable: 'police_clearance_requests', sourceId: recordId, status: 'Ready for Collection',
      });
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: 'Police Clearance Certificate ready',
        message: `Reference ${referenceNumber}. Your certificate has been generated automatically and is ready for collection.`,
        type: 'Ready for Collection',
      });
      res.status(201).json({ recordId, referenceNumber, status: 'Ready for Collection', certificateNumber, clearanceResult });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

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

/** GET /api/police/clearance/:id/certificate — the formatted, printable certificate.
 *
 *  Batch 34 — "it should show whether the citizen has been arrested and if yes in which year
 *  what are the charges and sentence automatically": per the settled answer, the printed
 *  certificate itself (not just the officer's pre-approval review screen, which already had
 *  this via GET .../history) now carries that detail when the result is 'Record Found'. It is
 *  deliberately scoped to actual convictions only (outcome = 'Convicted - Sentenced', the same
 *  one thing that ever makes clearance_result = 'Record Found' in the first place — see
 *  policeHistory.js's computeSuggestedClearanceResult) — a mere arrest, open case, or acquittal
 *  is still never printed here, same fairness principle that already governs the verdict
 *  itself, just now also applied to what level of detail backs it up. */
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

    let convictions = [];
    if (record.clearance_result === 'Record Found') {
      const { rows: convictionRows } = await db.query(
        `SELECT s.sentence_id, s.outcome, s.sentence_details, s.court_name, s.sentence_date, s.created_at,
                a.charge, c.case_reference
         FROM police_sentences s
         JOIN police_cases c ON c.case_id = s.case_id
         LEFT JOIN police_arrests a ON a.arrest_id = s.arrest_id
         WHERE s.subject_citizen_id = $1 AND s.outcome = 'Convicted - Sentenced'
         ORDER BY COALESCE(s.sentence_date, s.created_at::date) DESC`,
        [record.citizen_id]
      );
      convictions = convictionRows;
    }
    res.json({ clearance: record, convictions });
  } catch (err) { next(err); }
}

module.exports = { ...base, apply, getCertificate, resubmit, getHistory };
