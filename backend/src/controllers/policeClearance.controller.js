const db = require('../config/db');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');
const { recordAudit } = require('../utils/audit');
const { getDepartmentId } = require('../utils/lookup');

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
      extra: (record, req) => {
        const clearanceResult = req.body.clearanceResult === 'Record Found' ? 'Record Found' : 'Clean Record';
        const certificateNumber = 'PCC-' + String(Math.floor(100000 + Math.random() * 900000));
        return {
          setSql: `certificate_number = $3, issue_date = CURRENT_DATE, clearance_result = $4::varchar, officer_notes = $5`,
          params: [certificateNumber, clearanceResult, req.body.officerNotes || null],
        };
      },
    },
    'ready-for-collection': { from: 'Approved', to: 'Ready for Collection' },
    'collect': { from: 'Ready for Collection', to: 'Collected' },
  },
});

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

module.exports = { ...base, getCertificate };
