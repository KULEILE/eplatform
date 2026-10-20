const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { getDepartmentId } = require('../utils/lookup');
const { recordAudit } = require('../utils/audit');
const { isValidTemplate, bestScoreForRow } = require('../utils/handMatch');
const { getCaseHistoryForCitizen } = require('../utils/policeHistory');

const OFFICER_ROLES = ['police_officer', 'system_administrator'];
const MIN_CANDIDATE_SCORE = 35; // below this, a candidate is noise, not worth showing the officer
const MAX_CANDIDATES = 5;

/**
 * POST /api/police/identity-verification
 *
 * The ONLY way a Police officer touches citizen identity data. This is deliberately NOT a
 * general citizen search: a lawful operational reason (purpose) is mandatory, the officer
 * receives only a verification outcome (not a browsable profile), and every call — matched
 * or not — is written to the audit log per FR11 / the report's privacy-by-design requirement.
 *
 * Three ways to reach a result, all funnelled through this one audited endpoint:
 *   - body: { permanentIdentityNumber?, dateOfBirth?, purpose, caseReference? }
 *   - body: { providedName, purpose, caseReference? }
 *   - body: { matchMethod: 'Hand Biometric', confirmedCitizenId | noMatchConfirmed, similarityScore?, purpose, caseReference? }
 *     — the officer's final, visually-confirmed decision from the ranked candidate list that
 *     POST /api/police/identity-verification/biometric-search (below) returned. That search
 *     step never writes a police_records row by itself — only this confirmation does — so a
 *     hand-biometric lookup is never a silent single auto-identification.
 */
async function performLookup(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) {
      return res.status(403).json({ error: 'Only Police officers may perform an identity verification lookup.' });
    }
    const {
      permanentIdentityNumber, dateOfBirth, providedName, purpose, caseReference,
      matchMethod, confirmedCitizenId, similarityScore, noMatchConfirmed,
    } = req.body;
    if (!purpose || !purpose.trim()) {
      return res.status(400).json({ error: 'A lawful operational reason (purpose) is required for every identity lookup.' });
    }

    const isBiometric = matchMethod === 'Hand Biometric';
    let matchResult = 'No Match';
    let citizen = null;

    if (isBiometric) {
      if (!confirmedCitizenId && !noMatchConfirmed) {
        return res.status(400).json({ error: 'Confirm a specific candidate from the search results, or confirm that none match, before recording this lookup.' });
      }
      if (confirmedCitizenId) {
        const { rows } = await db.query(
          `SELECT citizen_id, first_name, last_name, date_of_birth, sex, permanent_identity_number, is_deceased
           FROM citizens WHERE citizen_id = $1`,
          [confirmedCitizenId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'The confirmed candidate no longer exists.' });
        citizen = rows[0];
        matchResult = 'Match Found';
      }
    } else if (permanentIdentityNumber) {
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
    } else if (providedName) {
      const parts = providedName.trim().split(/\s+/);
      const { rows } = await db.query(
        `SELECT citizen_id, first_name, last_name, date_of_birth, sex, permanent_identity_number, is_deceased
         FROM citizens WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2) LIMIT 1`,
        [parts[0] || '', parts[parts.length - 1] || '']
      );
      if (rows.length > 0) { citizen = rows[0]; matchResult = 'Match Found'; }
    } else {
      return res.status(400).json({ error: 'Provide either a permanent identity number, a provided name, or a confirmed hand-biometric candidate to search.' });
    }

    const lookupReference = generateReference('PL');
    const { rows: inserted } = await db.query(
      `INSERT INTO police_records (citizen_id, officer_user_id, lookup_reference, purpose, provided_name, verification_result, case_reference, status, match_method, similarity_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Completed',$8,$9) RETURNING *`,
      [
        citizen ? citizen.citizen_id : null, req.user.userId, lookupReference, purpose,
        providedName || (citizen ? `${citizen.first_name} ${citizen.last_name}` : null), matchResult, caseReference || null,
        isBiometric ? 'Hand Biometric' : 'Manual',
        isBiometric ? (similarityScore ?? null) : null,
      ]
    );

    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('police'),
      action: 'POLICE_IDENTITY_LOOKUP', targetType: 'citizen', targetId: citizen ? citizen.citizen_id : null,
      reason: purpose, metadata: { lookupReference, result: matchResult, caseReference: caseReference || null, matchMethod: isBiometric ? 'Hand Biometric' : 'Manual' },
    });

    // Minimum necessary access: only verification outcome + name/DOB/sex are returned — never
    // the full civil registration record, and never anything from other departments. caseHistory
    // is the one deliberate exception to "minimum necessary": this tool exists specifically for a
    // lawful, purpose-stated, audited operational check, and a citizen's own case/arrest/sentence
    // record (migration 054) is squarely what "performing other police work" on a confirmed match
    // means — it is NOT extra disclosure beyond this endpoint's stated purpose, so it's included
    // only when a real match was confirmed, never for a 'No Match'/'Possible Mismatch' result.
    const caseHistory = citizen ? await getCaseHistoryForCitizen(citizen.citizen_id) : null;

    res.status(201).json({
      lookupReference,
      verificationResult: matchResult,
      matchMethod: isBiometric ? 'Hand Biometric' : 'Manual',
      citizen: citizen ? {
        firstName: citizen.first_name, lastName: citizen.last_name, dateOfBirth: citizen.date_of_birth,
        sex: citizen.sex, permanentIdentityNumber: citizen.permanent_identity_number,
        deceased: citizen.is_deceased,
      } : null,
      caseHistory,
      policeRecordId: inserted[0].police_record_id,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/police/identity-verification/biometric-search
 *
 * Step 1 of a hand-biometric lookup: compares the officer's just-scanned hand (extracted
 * client-side — see frontend/src/utils/handGeometry.js and components/HandScan.jsx) against
 * every citizen's enrolled hand template (citizen_biometrics — migration 052) and returns a
 * RANKED list of candidates with a similarity score each.
 *
 * This is deliberately NOT a match by itself — nothing is written to police_records here, and
 * nothing here counts as a verification outcome. The officer must look at this ranked list and
 * explicitly confirm one specific candidate, or confirm that none of them are right, via
 * POST /api/police/identity-verification (matchMethod: 'Hand Biometric') — the same
 * human-in-the-loop requirement as every other lookup mode, never a silent auto-identification.
 *
 * Minimum-necessary-disclosure: only the same fields a manual lookup already returns (name,
 * date of birth, sex, permanent identity number) plus a similarity score are ever sent back —
 * never a photo, and never anything from another department.
 */
async function searchByHandBiometric(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) {
      return res.status(403).json({ error: 'Only Police officers may perform an identity verification lookup.' });
    }
    const { template, purpose, caseReference } = req.body;
    if (!purpose || !purpose.trim()) {
      return res.status(400).json({ error: 'A lawful operational reason (purpose) is required for every identity lookup.' });
    }
    if (!isValidTemplate(template)) {
      return res.status(400).json({ error: 'A valid hand scan is required — scan a hand before searching.' });
    }

    const { rows } = await db.query(
      `SELECT b.citizen_id, b.left_hand_template, b.right_hand_template,
              c.first_name, c.last_name, c.date_of_birth, c.sex, c.permanent_identity_number
       FROM citizen_biometrics b
       JOIN citizens c ON c.citizen_id = b.citizen_id
       WHERE NOT c.is_deceased`
    );

    const candidates = rows
      .map((row) => ({ row, score: bestScoreForRow(template, row) }))
      .filter((c) => c.score >= MIN_CANDIDATE_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES)
      .map((c) => ({
        citizenId: c.row.citizen_id, firstName: c.row.first_name, lastName: c.row.last_name,
        dateOfBirth: c.row.date_of_birth, sex: c.row.sex, permanentIdentityNumber: c.row.permanent_identity_number,
        similarityScore: c.score,
      }));

    // Every search attempt is audited, matched or not — the same FR11 principle a manual lookup
    // already gets by writing a police_records row (performLookup above). A biometric SEARCH
    // doesn't write one of those by itself (see this function's doc comment), so it needs its
    // own audit entry here instead.
    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('police'),
      action: 'POLICE_BIOMETRIC_SEARCH', targetType: 'citizen', targetId: null,
      reason: purpose, metadata: { caseReference: caseReference || null, candidateCount: candidates.length, topScore: candidates[0] ? candidates[0].similarityScore : null },
    });

    res.json({ candidates });
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

module.exports = { performLookup, searchByHandBiometric, listLookups, getLookup };
