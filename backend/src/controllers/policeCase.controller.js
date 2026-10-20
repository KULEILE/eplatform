/**
 * Case / arrest / sentence recording — the officer-initiated "perform other police work" side of
 * the department, separate from both the citizen-facing Police Clearance Certificate
 * (policeClearance.controller.js) and the identity-verification lookup (police.controller.js).
 *
 * Three actions, three tables (migration 054): startCase, recordArrest, recordSentence. Kept as
 * three explicit steps rather than one combined "arrest someone" form, because that's genuinely
 * how this works even in this simplified prototype model — a case can exist with no arrest yet
 * (under investigation), an arrest can exist with no sentence yet (awaiting trial), and a case can
 * have more than one arrest or more than one person involved. Forcing all three into a single
 * step would make it impossible to represent any of that.
 *
 * subject_citizen_id is intentionally found by looking up a permanent identity number against
 * the citizens table (not a free citizen-search box) — same "controlled, purpose-bound lookup"
 * posture as police.controller.js's identity verification, not a general directory browse. When
 * no permanent identity number is given, or it doesn't match anyone in this system, the subject
 * is still recorded by name only (subject_citizen_id left null) — a real case can concern someone
 * not yet identified or not a citizen in this system at all.
 */
const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { getDepartmentId } = require('../utils/lookup');
const { recordAudit } = require('../utils/audit');
const { getCaseHistoryForCitizen } = require('../utils/policeHistory');

const OFFICER_ROLES = ['police_officer', 'system_administrator'];

async function resolveSubject({ permanentIdentityNumber, subjectName }) {
  if (permanentIdentityNumber) {
    const { rows } = await db.query(
      'SELECT citizen_id, first_name, last_name FROM citizens WHERE permanent_identity_number = $1',
      [permanentIdentityNumber]
    );
    if (rows.length > 0) {
      return { citizenId: rows[0].citizen_id, name: subjectName || `${rows[0].first_name} ${rows[0].last_name}` };
    }
  }
  return { citizenId: null, name: subjectName || null };
}

/** POST /api/police/cases — officer opens a new case.
 *  body: { caseType, offenseDescription, permanentIdentityNumber?, subjectName? }
 *  At least one of permanentIdentityNumber (if it matches someone) or subjectName is required —
 *  a case has to name SOMEONE, even if only "unknown male, approx. 30s" as free text. */
async function startCase(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { caseType, offenseDescription, permanentIdentityNumber, subjectName } = req.body;
    if (!offenseDescription || !offenseDescription.trim()) {
      return res.status(400).json({ error: 'A description of the offense/matter is required.' });
    }
    const subject = await resolveSubject({ permanentIdentityNumber, subjectName });
    if (!subject.citizenId && !subject.name) {
      return res.status(400).json({ error: 'Provide a permanent identity number that matches a citizen, or a subject name, for this case.' });
    }

    const caseReference = generateReference('PCS');
    const { rows } = await db.query(
      `INSERT INTO police_cases (case_reference, subject_citizen_id, subject_name, case_type, offense_description, status, opened_by_user_id)
       VALUES ($1,$2,$3,$4,$5,'Open',$6) RETURNING *`,
      [caseReference, subject.citizenId, subject.name, caseType || 'Criminal Investigation', offenseDescription.trim(), req.user.userId]
    );
    const record = rows[0];

    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('police'),
      action: 'POLICE_CASE_OPENED', targetType: 'police_case', targetId: record.case_id,
      reason: offenseDescription.trim(), metadata: { caseReference, subjectCitizenId: subject.citizenId, subjectName: subject.name },
    });

    res.status(201).json({ case: record });
  } catch (err) { next(err); }
}

/** GET /api/police/cases — officer's case list (every officer sees every case; this is
 *  investigative casework shared across the department, not a personal queue like the
 *  identity-verification lookup history is). Optional ?status= filter. */
async function listCases(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { status } = req.query;
    const { rows } = await db.query(
      `SELECT pc.*, u.email AS opened_by_email,
              (SELECT COUNT(*) FROM police_arrests a WHERE a.case_id = pc.case_id) AS arrest_count,
              (SELECT COUNT(*) FROM police_sentences s WHERE s.case_id = pc.case_id) AS sentence_count
       FROM police_cases pc LEFT JOIN users u ON u.user_id = pc.opened_by_user_id
       WHERE $1::text IS NULL OR pc.status = $1 ORDER BY pc.created_at DESC`,
      [status || null]
    );
    res.json({ cases: rows });
  } catch (err) { next(err); }
}

/** GET /api/police/cases/:id — case detail, with its arrests and sentences. */
async function getCase(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { rows } = await db.query('SELECT * FROM police_cases WHERE case_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Case not found.' });
    const [{ rows: arrests }, { rows: sentences }] = await Promise.all([
      db.query(
        `SELECT a.*, u.email AS arresting_officer_email FROM police_arrests a
         LEFT JOIN users u ON u.user_id = a.arresting_officer_user_id
         WHERE a.case_id = $1 ORDER BY a.arrest_date DESC`,
        [req.params.id]
      ),
      db.query(
        `SELECT s.*, u.email AS recorded_by_email FROM police_sentences s
         LEFT JOIN users u ON u.user_id = s.recorded_by_user_id
         WHERE s.case_id = $1 ORDER BY COALESCE(s.sentence_date, s.created_at::date) DESC`,
        [req.params.id]
      ),
    ]);
    res.json({ case: rows[0], arrests, sentences });
  } catch (err) { next(err); }
}

/** PATCH /api/police/cases/:id/status — move a case between Open / Under Investigation /
 *  Referred to Court / Closed - Resolved / Closed - Unresolved. Deliberately not tied to a fixed
 *  linear statusFlow (unlike the citizen-facing department services): real casework doesn't move
 *  in one direction — a closed case can be reopened if new evidence turns up — so this just
 *  records whatever status the officer sets, with a reason, rather than enforcing a from->to map. */
async function setCaseStatus(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { status, note } = req.body;
    const VALID = ['Open', 'Under Investigation', 'Referred to Court', 'Closed - Resolved', 'Closed - Unresolved'];
    if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });
    const closedAt = status.startsWith('Closed') ? 'NOW()' : 'NULL';
    const { rows } = await db.query(
      `UPDATE police_cases SET status = $1, closed_at = ${closedAt}, updated_at = NOW() WHERE case_id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Case not found.' });
    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('police'),
      action: 'POLICE_CASE_STATUS_CHANGED', targetType: 'police_case', targetId: rows[0].case_id,
      reason: note || null, metadata: { status },
    });
    res.json({ case: rows[0] });
  } catch (err) { next(err); }
}

/** POST /api/police/cases/:id/arrests — record an arrest against a case.
 *  body: { charge, custodyStatus?, notes?, permanentIdentityNumber?, subjectName? }
 *  The arrest's subject defaults to the case's own subject if neither permanentIdentityNumber
 *  nor subjectName is given — covers the common case where the person arrested is exactly who
 *  the case was already opened against. */
async function recordArrest(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { charge, custodyStatus, notes, permanentIdentityNumber, subjectName } = req.body;
    if (!charge || !charge.trim()) return res.status(400).json({ error: 'The charge is required.' });

    const { rows: caseRows } = await db.query('SELECT * FROM police_cases WHERE case_id = $1', [req.params.id]);
    if (caseRows.length === 0) return res.status(404).json({ error: 'Case not found.' });
    const policeCase = caseRows[0];

    const subject = (permanentIdentityNumber || subjectName)
      ? await resolveSubject({ permanentIdentityNumber, subjectName })
      : { citizenId: policeCase.subject_citizen_id, name: policeCase.subject_name };

    const arrestReference = generateReference('PAR');
    const { rows } = await db.query(
      `INSERT INTO police_arrests (case_id, arrest_reference, subject_citizen_id, subject_name, charge, arresting_officer_user_id, custody_status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [policeCase.case_id, arrestReference, subject.citizenId, subject.name, charge.trim(), req.user.userId, custodyStatus || 'In Custody', notes || null]
    );
    const record = rows[0];

    // An arrest is real investigative progress — move a freshly 'Open' case forward automatically
    // so it doesn't silently sit at 'Open' with an arrest already on it; an officer can still set
    // any other status explicitly afterwards via setCaseStatus.
    if (policeCase.status === 'Open') {
      await db.query(`UPDATE police_cases SET status = 'Under Investigation', updated_at = NOW() WHERE case_id = $1`, [policeCase.case_id]);
    }

    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('police'),
      action: 'POLICE_ARREST_RECORDED', targetType: 'police_arrest', targetId: record.arrest_id,
      reason: charge.trim(), metadata: { arrestReference, caseReference: policeCase.case_reference, subjectCitizenId: subject.citizenId },
    });

    res.status(201).json({ arrest: record });
  } catch (err) { next(err); }
}

/** POST /api/police/cases/:id/sentences — record a conviction/sentence outcome against a case.
 *  body: { outcome, sentenceDetails?, courtName?, sentenceDate?, arrestId?, permanentIdentityNumber?, subjectName? }
 *  sentenceDetails is required when outcome = 'Convicted - Sentenced' (what the actual sentence
 *  was), optional otherwise — an acquittal or dismissal doesn't need a sentence description. */
async function recordSentence(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { outcome, sentenceDetails, courtName, sentenceDate, arrestId, permanentIdentityNumber, subjectName } = req.body;
    const VALID_OUTCOMES = ['Convicted - Sentenced', 'Acquitted', 'Case Dismissed', 'Caution/Diversion'];
    if (!VALID_OUTCOMES.includes(outcome)) return res.status(400).json({ error: `outcome must be one of: ${VALID_OUTCOMES.join(', ')}` });
    if (outcome === 'Convicted - Sentenced' && (!sentenceDetails || !sentenceDetails.trim())) {
      return res.status(400).json({ error: 'sentenceDetails (what the sentence actually was) is required when the outcome is a conviction.' });
    }

    const { rows: caseRows } = await db.query('SELECT * FROM police_cases WHERE case_id = $1', [req.params.id]);
    if (caseRows.length === 0) return res.status(404).json({ error: 'Case not found.' });
    const policeCase = caseRows[0];

    if (arrestId) {
      const { rows: arrestRows } = await db.query('SELECT 1 FROM police_arrests WHERE arrest_id = $1 AND case_id = $2', [arrestId, policeCase.case_id]);
      if (arrestRows.length === 0) return res.status(400).json({ error: 'arrestId does not belong to this case.' });
    }

    const subject = (permanentIdentityNumber || subjectName)
      ? await resolveSubject({ permanentIdentityNumber, subjectName })
      : { citizenId: policeCase.subject_citizen_id, name: policeCase.subject_name };

    const { rows } = await db.query(
      `INSERT INTO police_sentences (case_id, arrest_id, subject_citizen_id, subject_name, outcome, sentence_details, court_name, sentence_date, recorded_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        policeCase.case_id, arrestId || null, subject.citizenId, subject.name, outcome,
        sentenceDetails ? sentenceDetails.trim() : null, courtName || null, sentenceDate || null, req.user.userId,
      ]
    );
    const record = rows[0];

    // A recorded outcome is the natural end of a case's active life in this simplified model —
    // move it to Closed so it drops out of the "needs attention" view, same reasoning as the
    // auto-advance-on-arrest above. An officer can still reopen it via setCaseStatus if needed.
    await db.query(
      `UPDATE police_cases SET status = 'Closed - Resolved', closed_at = NOW(), updated_at = NOW() WHERE case_id = $1`,
      [policeCase.case_id]
    );

    await recordAudit({
      userId: req.user.userId, departmentId: await getDepartmentId('police'),
      action: 'POLICE_SENTENCE_RECORDED', targetType: 'police_sentence', targetId: record.sentence_id,
      reason: sentenceDetails || outcome, metadata: { caseReference: policeCase.case_reference, outcome, subjectCitizenId: subject.citizenId },
    });

    res.status(201).json({ sentence: record });
  } catch (err) { next(err); }
}

/** GET /api/police/cases/citizen-history?permanentIdentityNumber=... — officer-only lookup of a
 *  specific citizen's full case/arrest/sentence history by their permanent identity number.
 *  Separate from the identity-verification lookup (police.controller.js) because this one is for
 *  an officer already looking at a specific case/arrest/sentence form who wants to check someone's
 *  prior record before naming them as the subject — it does not create a police_records row or
 *  count as a formal identity-verification lookup, and is not audited the same way, since it's a
 *  read against data this officer already has access to (case management), not a new disclosure
 *  of citizen identity data the way the identity-verification tool is. */
async function citizenHistory(req, res, next) {
  try {
    if (!OFFICER_ROLES.includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { permanentIdentityNumber } = req.query;
    if (!permanentIdentityNumber) return res.status(400).json({ error: 'permanentIdentityNumber is required.' });
    const { rows } = await db.query(
      'SELECT citizen_id, first_name, last_name, date_of_birth, sex FROM citizens WHERE permanent_identity_number = $1',
      [permanentIdentityNumber]
    );
    if (rows.length === 0) return res.json({ citizen: null, history: { cases: [], arrests: [], sentences: [] } });
    const history = await getCaseHistoryForCitizen(rows[0].citizen_id);
    res.json({ citizen: rows[0], history });
  } catch (err) { next(err); }
}

/** GET /api/police/cases/track?caseReference=... — citizen-facing "Criminal case tracking"
 *  (service #10 on the department's service list: "Check permitted updates using a case
 *  reference number"). Deliberately NOT a free lookup by reference number alone — the citizen
 *  must be logged in, and the case must actually belong to them (they are its subject_citizen_id)
 *  for anything to come back. This is a different, narrower tool than "My Applications" (which
 *  already tracks every report THEY submitted, via the application index every
 *  simpleDepartmentController-based apply() call feeds automatically) — a criminal case is
 *  opened by an officer, not submitted by the citizen, so it needs its own lookup, and it only
 *  ever shows what's "permitted" — case type, status and opened date — never arrest or sentence
 *  detail, which stays for officer eyes only (see policeHistory.js / citizenHistory above). */
async function trackCase(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to track a case.' });
    const { caseReference } = req.query;
    if (!caseReference || !caseReference.trim()) return res.status(400).json({ error: 'caseReference is required.' });
    const { rows } = await db.query(
      `SELECT case_reference, case_type, status, created_at, closed_at FROM police_cases
       WHERE case_reference = $1 AND subject_citizen_id = $2`,
      [caseReference.trim(), req.user.citizenId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No case found with that reference number on your record.' });
    }
    res.json({ case: rows[0] });
  } catch (err) { next(err); }
}

module.exports = { startCase, listCases, getCase, setCaseStatus, recordArrest, recordSentence, citizenHistory, trackCase };
