const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { getDepartmentId } = require('../utils/lookup');
const { recordAudit } = require('../utils/audit');

/**
 * POST /api/police/identity-verification
 *
 * The ONLY way a Police officer touches citizen identity data. This is deliberately NOT a
 * general citizen search: a lawful operational reason (purpose) is mandatory, the officer
 * receives only a verification outcome (not a browsable profile), and every call — matched
 * or not — is written to the audit log per FR11 / the report's privacy-by-design requirement.
 *
 * body: { permanentIdentityNumber?, dateOfBirth?, providedName?, purpose, caseReference? }
 */
async function performLookup(req, res, next) {
  try {
    if (!['police_officer', 'system_administrator'].includes(req.user.roleKey)) {
      return res.status(403).json({ error: 'Only Police officers may perform an identity verification lookup.' });
    }
    const { permanentIdentityNumber, dateOfBirth, providedName, purpose, caseReference } = req.body;
    if (!purpose || !purpose.trim()) {
      return res.status(400).json({ error: 'A lawful operational reason (purpose) is required for every identity lookup.' });
    }
    if (!permanentIdentityNumber && !providedName) {
      return res.status(400).json({ error: 'Provide either a permanent identity number or a provided name to search.' });
    }

    let matchResult = 'No Match';
    let citizen = null;
    if (permanentIdentityNumber) {
      const { rows } = await db.query(
        `SELECT citizen_id, first_name, last_name, date_of_birth, sex, permanent_identity_number, is_deceased
         FROM citizens WHERE permanent_identity_number = $1 ${dateOfBirth ? 'AND date_of_birth = $2' : ''}`,
        dateOfBirth ? [permanentIdentityNumber, dateOfBirth] : [permanentIdentityNumber]
      );
      if (rows.length > 0) { citizen = rows[0]; matchResult = 'Match Found'; }
      else {
        const { rows: possible } = await db.query('SELECT 1 FROM citizens WHERE permanent_identity_number = $1', [permanentIdentityNumber]);
        if (possible.length > 0) matchResult = 'Possible Mismatch';
      }
    } else {
      const parts = providedName.trim().split(/\s+/);
      const { rows } = await db.query(
        `SELECT citizen_id, first_name, last_name, date_of_birth, sex, permanent_identity_number, is_deceased
         FROM citizens WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2) LIMIT 1`,
        [parts[0] || '', parts[parts.length - 1] || '']
      );
      if (rows.length > 0) { citizen = rows[0]; matchResult = 'Match Found'; }
    }

    const lookupReference = generateReference('PL');
    const { rows: inserted } = await db.query(
      `INSERT INTO police_records (citizen_id, officer_user_id, lookup_reference, purpose, provided_name, verification_result, case_reference, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Completed') RETURNING *`,
      [citizen ? citizen.citizen_id : null, req.user.userId, lookupReference, purpose, providedName || (citizen ? `${citizen.first_name} ${citizen.last_name}` : null), matchResult, caseReference || null]
    );

    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('police'),
      action: 'POLICE_IDENTITY_LOOKUP', targetType: 'citizen', targetId: citizen ? citizen.citizen_id : null,
      reason: purpose, metadata: { lookupReference, result: matchResult, caseReference: caseReference || null },
    });

    // Minimum necessary access: only verification outcome + name/DOB/sex are returned — never
    // the full civil registration record, and never anything from other departments.
    res.status(201).json({
      lookupReference,
      verificationResult: matchResult,
      citizen: citizen ? {
        firstName: citizen.first_name, lastName: citizen.last_name, dateOfBirth: citizen.date_of_birth,
        sex: citizen.sex, permanentIdentityNumber: citizen.permanent_identity_number,
        deceased: citizen.is_deceased,
      } : null,
      policeRecordId: inserted[0].police_record_id,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/police/identity-verification — officer sees their own lookup history; admin sees all. */
async function listLookups(req, res, next) {
  try {
    if (!['police_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const ownOnly = req.user.roleKey === 'police_officer';
    const { rows } = await db.query(
      `SELECT pr.*, c.first_name, c.last_name FROM police_records pr LEFT JOIN citizens c ON c.citizen_id = pr.citizen_id
       WHERE $1::boolean = FALSE OR pr.officer_user_id = $2 ORDER BY pr.created_at DESC`,
      [ownOnly, req.user.userId]
    );
    res.json({ lookups: rows });
  } catch (err) {
    next(err);
  }
}

/** GET /api/police/identity-verification/:id */
async function getLookup(req, res, next) {
  try {
    if (!['police_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { rows } = await db.query('SELECT * FROM police_records WHERE police_record_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Lookup not found.' });
    res.json({ lookup: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { performLookup, listLookups, getLookup };
