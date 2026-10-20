/**
 * Shared lookups against police_cases/police_arrests/police_sentences (migration 054) — used by
 * both the Police Clearance Certificate review flow (policeClearance.controller.js, so an
 * officer approving a certificate can see what's actually on record and get an auto-suggested
 * verdict) and the officer-only identity-verification lookup (police.controller.js, so an
 * officer "checking a person" sees their case/arrest/sentence history as part of that one
 * audited lookup, rather than needing a second, unaudited query somewhere else).
 *
 * Both callers are already purpose-bound, officer-only, and audited at the call site — this
 * module itself does no authorization and no audit logging; it's a plain data lookup, same as
 * any other shared query helper in utils/.
 */
const db = require('../config/db');

/** Every case/arrest/sentence on record for a citizen, most recent first. Returns empty arrays
 *  (never throws, never returns null) for a citizen with no history — the normal case. */
async function getCaseHistoryForCitizen(citizenId) {
  if (!citizenId) return { cases: [], arrests: [], sentences: [] };

  const [{ rows: cases }, { rows: arrests }, { rows: sentences }] = await Promise.all([
    db.query(
      `SELECT case_id, case_reference, case_type, offense_description, status, created_at
       FROM police_cases WHERE subject_citizen_id = $1 ORDER BY created_at DESC`,
      [citizenId]
    ),
    db.query(
      `SELECT a.arrest_id, a.arrest_reference, a.case_id, c.case_reference, a.charge, a.arrest_date, a.custody_status
       FROM police_arrests a JOIN police_cases c ON c.case_id = a.case_id
       WHERE a.subject_citizen_id = $1 ORDER BY a.arrest_date DESC`,
      [citizenId]
    ),
    db.query(
      `SELECT s.sentence_id, s.case_id, c.case_reference, s.arrest_id, s.outcome, s.sentence_details,
              s.court_name, s.sentence_date, s.created_at
       FROM police_sentences s JOIN police_cases c ON c.case_id = s.case_id
       WHERE s.subject_citizen_id = $1 ORDER BY COALESCE(s.sentence_date, s.created_at::date) DESC`,
      [citizenId]
    ),
  ]);

  return { cases, arrests, sentences };
}

/** The ONLY thing that should ever suggest "Record Found" on a Police Clearance Certificate is
 *  an actual conviction (police_sentences.outcome = 'Convicted - Sentenced') — never a mere open
 *  case, an arrest, an acquittal, or a caution/diversion. Those are shown to the reviewing
 *  officer as context (see getCaseHistoryForCitizen above), but they must not, by themselves,
 *  flip a certificate to "Record Found": that would effectively punish someone on this system for
 *  having been investigated or accused, not for having been found guilty of anything. This is a
 *  SUGGESTION only — the officer reviewing the application can always override it either way (see
 *  policeClearance.controller.js's 'approve' transition), this function never decides anything by
 *  itself. */
async function computeSuggestedClearanceResult(citizenId) {
  if (!citizenId) return 'Clean Record';
  const { rows } = await db.query(
    `SELECT 1 FROM police_sentences WHERE subject_citizen_id = $1 AND outcome = 'Convicted - Sentenced' LIMIT 1`,
    [citizenId]
  );
  return rows.length > 0 ? 'Record Found' : 'Clean Record';
}

module.exports = { getCaseHistoryForCitizen, computeSuggestedClearanceResult };
