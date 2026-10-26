/**
 * Five more Traffic services, added alongside the original five (now in traffic.controller.js
 * with required photo/biometric capture — see migration 042):
 *
 *   - Driving Theory Test / Practical Driving Test (driving_test_bookings) — a bespoke booking
 *     workflow (Requested -> Scheduled -> Completed, or Cancelled/Rejected), not a reuse of the
 *     licence-issuing pipeline, because a test booking's lifecycle is genuinely different.
 *
 *     Migration 067 rebuilt this around the real sequence a learner driver follows: a citizen
 *     books ONLY the theory test, which is auto-scheduled immediately (no officer "schedule"
 *     step needed). Migration 068 then turned the Theory test into a real, self-marking
 *     multiple-choice exam (see the THEORY TEST SESSIONS section below).
 *
 *     Migration 069 (Batch 20) changed what happens next on a Theory Pass: the Practical booking
 *     is still auto-created with no citizen action, but — "the system before it schedule it
 *     should aske officer the location where practical will take place and the time they will
 *     start" — it now lands as 'Requested' with only a SUGGESTED date (the very next day after
 *     the theory sitting, reduced from three days — "it should be following day after theory
 *     test") rather than jumping straight to 'Scheduled'. An officer must call
 *     schedulePracticalTest() with a venue AND a start time before it becomes 'Scheduled'; an
 *     already-scheduled Practical booking, or an already-published Theory session, can also be
 *     postponed afterwards by an officer (postponeTestBooking() / postponeTheorySession()) —
 *     "the system must allow officer to postpone test because someday weather may be bad or
 *     move." A Practical Pass still automatically produces a Learner's Permit (2-year validity)
 *     in traffic_records, reusing the citizen's National ID photo and fingerprints rather than
 *     capturing anything fresh — see autoGenerateLearnerPermit() below. A Learner Permit used to
 *     be its own hub tile/page (a read-only status view, since it's never applied for directly);
 *     Batch 20 folded that same read-only status view into THIS page instead — see the
 *     citizen's and officer's Learner's Permit panels in
 *     frontend/src/pages/traffic/DrivingTestBookings.jsx — because a separate "Learner Permit"
 *     service next to "Driving Theory / Practical Test" read as two services doing the same
 *     work ("we learner permit and driving theory test which make the same work that is
 *     repetition").
 *   - Roadworthiness Test & Certificate of Fitness (vehicle_inspections) — reuses
 *     makeDepartmentController, the same linear "apply -> review -> approve (assigns a number)"
 *     shape as traffic_records. Requires an Approved vehicle registration for the given
 *     vehicle_registration_number.
 *   - Transport Operating Permit, new or renewal (transport_operating_permits) — also reuses
 *     makeDepartmentController. Requires a valid, unexpired Certificate of Fitness for the
 *     vehicle: a commercial transport permit cannot be granted for a vehicle not confirmed
 *     roadworthy.
 *   - Driving Instructor & Examiner Certification (driving_instructor_registrations) — an
 *     admin-only registry, the same shape as marriage_officer_registrations in Home Affairs:
 *     there is no citizen applicant, a Traffic officer or system administrator manages it
 *     directly.
 */
const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { indexApplication, syncApplicationStatus, getDepartmentId } = require('../utils/lookup');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');
const { makeDepartmentController } = require('../utils/simpleDepartmentController');

const TRAFFIC_OFFICER_ROLES = ['traffic_officer', 'system_administrator'];
const isOfficer = (req) => TRAFFIC_OFFICER_ROLES.includes(req.user.roleKey);

// Migration 068: the Theory test is now a multiple-choice exam the system marks itself. A
// citizen's score is correctCount / totalQuestions * 100, rounded; this is the line between
// Passed and Failed. Not specified by the request, so a reasonable real-world figure is used —
// called out here, once, rather than buried in the scoring code below.
const THEORY_PASS_PERCENT = 70;

function genNumber(prefix) {
  return `${prefix}-${String(Math.floor(100000 + Math.random() * 900000))}`;
}

async function citizenHasApprovedTrafficRecord(citizenId, column, value) {
  const { rows } = await db.query(
    `SELECT 1 FROM traffic_records WHERE citizen_id = $1 AND ${column} = $2
     AND status IN ('Approved', 'Ready for Collection', 'Collected')`,
    [citizenId, value]
  );
  return rows.length > 0;
}

// ============================================================================================
// DRIVING THEORY TEST / PRACTICAL DRIVING TEST
// ============================================================================================

/** POST /traffic/test-bookings (citizen) — only the Theory test can be requested directly; the
 *  Practical test is always auto-created by recordTestResult() below once Theory is passed, so
 *  there is nothing for a citizen to book there. Auto-schedules immediately (status goes
 *  straight to 'Scheduled', confirmed_date = the citizen's requested date) — "automatically
 *  schedule that test" — rather than sitting in 'Requested' awaiting an officer. */
async function requestTestBooking(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to book a driving test.' });
    const { testType, requestedDate, officeId } = req.body;
    if (testType !== 'Theory') {
      return res.status(400).json({ error: 'Only the theory test can be booked directly — the practical test is scheduled automatically once you pass your theory test.' });
    }
    if (!requestedDate) return res.status(400).json({ error: 'requestedDate is required.' });
    const todayStr = new Date().toISOString().slice(0, 10);
    if (requestedDate < todayStr) return res.status(400).json({ error: 'requestedDate must be today or a future date.' });
    if (!officeId) return res.status(400).json({ error: 'officeId is required — choose your preferred test centre.' });

    const { rows: inProgress } = await db.query(
      `SELECT 1 FROM driving_test_bookings WHERE citizen_id = $1 AND test_type = 'Theory' AND status IN ('Requested', 'Scheduled')`,
      [req.user.citizenId]
    );
    if (inProgress.length > 0) return res.status(409).json({ error: 'You already have a theory test booked.' });

    const bookingReference = generateReference('DTB');
    const { rows } = await db.query(
      `INSERT INTO driving_test_bookings (citizen_id, booking_reference, test_type, requested_date, confirmed_date, office_id, status)
       VALUES ($1,$2,'Theory',$3,$3,$4,'Scheduled') RETURNING *`,
      [req.user.citizenId, bookingReference, requestedDate, officeId]
    );
    let booking = rows[0];
    await indexApplication(db, {
      citizenId: req.user.citizenId, departmentKey: 'traffic', serviceType: 'Theory Driving Test',
      referenceNumber: bookingReference, sourceTable: 'driving_test_bookings', sourceId: booking.driving_test_booking_id, status: 'Scheduled',
    });
    await createNotification({ userId: req.user.userId, title: 'Theory test scheduled', message: `Reference ${bookingReference}, on ${requestedDate}.`, type: 'Application Submitted' });

    // If the office already published a session for this exact date (a citizen booking in
    // after the officer published — e.g. another citizen for the same sitting), attach this
    // booking to it immediately rather than making them wait for the next publish.
    const { rows: sessionRows } = await db.query(
      `SELECT * FROM theory_test_sessions WHERE office_id = $1 AND test_date = $2 AND status = 'Published'`,
      [officeId, requestedDate]
    );
    if (sessionRows.length > 0) {
      const session = sessionRows[0];
      const { rows: linked } = await db.query(
        `UPDATE driving_test_bookings SET theory_session_id = $1, updated_at = NOW() WHERE driving_test_booking_id = $2 RETURNING *`,
        [session.theory_test_session_id, booking.driving_test_booking_id]
      );
      booking = linked[0];
      await createNotification({
        userId: req.user.userId, title: 'Theory test open', type: 'Status Change',
        message: `Your theory test for ${requestedDate}${session.test_time ? ` at ${String(session.test_time).slice(0, 5)}` : ''} is open — you can take it now.`,
      });
    }
    res.status(201).json({ booking });
  } catch (err) { next(err); }
}

// ============================================================================================
// THEORY TEST SESSIONS — the shared, officer-authored, multiple-choice question set every
// citizen sitting the Theory test on a given day (at a given office) writes, scored by the
// system itself. See migration 068.
// ============================================================================================

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return 'questions must be a non-empty list.';
  for (const q of questions) {
    if (!q || typeof q !== 'object') return 'Each question must be an object.';
    if (!q.question || !String(q.question).trim()) return 'Every question needs question text.';
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return 'Every question needs between 2 and 6 options.';
    if (q.options.some((o) => !o || !String(o).trim())) return 'Every option needs text.';
    const idx = Number(q.correctIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) return 'Every question needs a valid correctIndex.';
  }
  return null;
}

function normalizeQuestions(questions) {
  return questions.map((q) => ({
    question: String(q.question).trim(),
    options: q.options.map((o) => String(o).trim()),
    correctIndex: Number(q.correctIndex),
  }));
}

/** POST /traffic/theory-sessions (officer) body:{testDate, testTime?, questions} — creates the
 *  session for the officer's own office on that date if none exists yet, or updates it (while
 *  still Draft — "officer must set time" and author the shared question set before publishing).
 *  A Published session is locked: citizens may already be relying on exactly these questions. */
async function upsertTheorySession(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    if (!req.user.officeId) return res.status(400).json({ error: 'Your account has no office assigned — cannot manage theory sessions.' });
    const { testDate, testTime, questions } = req.body;
    if (!testDate) return res.status(400).json({ error: 'testDate is required.' });
    if (questions !== undefined) {
      const err = validateQuestions(questions);
      if (err) return res.status(400).json({ error: err });
    }

    const { rows: existingRows } = await db.query(
      `SELECT * FROM theory_test_sessions WHERE office_id = $1 AND test_date = $2`,
      [req.user.officeId, testDate]
    );
    if (existingRows.length > 0 && existingRows[0].status === 'Published') {
      return res.status(409).json({ error: 'This session is already published and cannot be edited.' });
    }

    let rows;
    if (existingRows.length > 0) {
      ({ rows } = await db.query(
        `UPDATE theory_test_sessions SET test_time = COALESCE($1, test_time), questions = COALESCE($2::jsonb, questions), updated_at = NOW()
         WHERE theory_test_session_id = $3 RETURNING *`,
        [testTime || null, questions ? JSON.stringify(normalizeQuestions(questions)) : null, existingRows[0].theory_test_session_id]
      ));
    } else {
      ({ rows } = await db.query(
        `INSERT INTO theory_test_sessions (office_id, test_date, test_time, questions, created_by_user_id)
         VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *`,
        [req.user.officeId, testDate, testTime || null, questions ? JSON.stringify(normalizeQuestions(questions)) : null, req.user.userId]
      ));
    }
    res.status(201).json({ session: rows[0] });
  } catch (err) { next(err); }
}

/** GET /traffic/theory-sessions (officer) — every session for the officer's own office, newest
 *  date first, with a count of how many Theory bookings are waiting on each one. */
async function listTheorySessions(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    if (!req.user.officeId) return res.json({ sessions: [] });
    const { rows } = await db.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM driving_test_bookings b
                WHERE b.test_type = 'Theory' AND b.office_id = s.office_id AND b.confirmed_date = s.test_date
                  AND b.status IN ('Scheduled', 'Completed')) AS booking_count
       FROM theory_test_sessions s WHERE s.office_id = $1 ORDER BY s.test_date DESC`,
      [req.user.officeId]
    );
    res.json({ sessions: rows });
  } catch (err) { next(err); }
}

/** POST /traffic/theory-sessions/:id/publish (officer) — "officer publish it, test all citizen
 *  who supposed to write must receive notification and open for them to take test." Locks the
 *  session, links every currently-Scheduled Theory booking for that office/date to it, and
 *  notifies each of those citizens that their test is now open. */
async function publishTheorySession(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows: sessionRows } = await client.query('SELECT * FROM theory_test_sessions WHERE theory_test_session_id = $1 FOR UPDATE', [req.params.id]);
      if (sessionRows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Session not found.' }); }
      const existing = sessionRows[0];
      if (!isOfficer(req) || existing.office_id !== req.user.officeId) {
        await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your office.' });
      }
      if (existing.status === 'Published') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Already published.' }); }
      if (!existing.test_time) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Set a test time before publishing.' }); }
      if (!existing.questions || existing.questions.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Add at least one question before publishing.' }); }

      const { rows: sessRows } = await client.query(
        `UPDATE theory_test_sessions SET status = 'Published', published_by_user_id = $1, published_at = NOW(), updated_at = NOW()
         WHERE theory_test_session_id = $2 RETURNING *`,
        [req.user.userId, req.params.id]
      );
      const session = sessRows[0];

      const { rows: bookings } = await client.query(
        `UPDATE driving_test_bookings SET theory_session_id = $1, updated_at = NOW()
         WHERE test_type = 'Theory' AND status = 'Scheduled' AND office_id = $2 AND confirmed_date = $3 AND theory_session_id IS NULL
         RETURNING *`,
        [session.theory_test_session_id, session.office_id, session.test_date]
      );
      await client.query('COMMIT');

      for (const booking of bookings) {
        const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [booking.citizen_id])).rows[0];
        if (userRow) {
          await createNotification({
            userId: userRow.user_id, title: 'Theory test open', type: 'Status Change',
            message: `Your theory test on ${String(session.test_date).slice(0, 10)} at ${String(session.test_time).slice(0, 5)} is open — you can take it now.`,
          });
        }
      }
      res.json({ session, bookingsOpened: bookings.length });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

/** POST /traffic/theory-sessions/:id/postpone (officer) body:{newDate, newTime?, reason} —
 *  "the system must allow officer to postpone test because someday weather may be bad or move."
 *  Moves an already-PUBLISHED sitting's date and/or time WITHOUT touching its locked question
 *  set, and carries every citizen already linked to it along to the new date automatically,
 *  notifying each of them. Refused if the office already has a different session on the new
 *  date — the one-sitting-per-office-per-day rule (migration 068's UNIQUE constraint) still
 *  applies, so this checks for that conflict itself rather than letting the database reject it. */
async function postponeTheorySession(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { newDate, newTime, reason } = req.body;
    if (!newDate) return res.status(400).json({ error: 'newDate is required.' });
    if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'A reason is required.' });
    const todayStr = new Date().toISOString().slice(0, 10);
    if (newDate < todayStr) return res.status(400).json({ error: 'newDate must be today or a future date.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows: sessionRows } = await client.query('SELECT * FROM theory_test_sessions WHERE theory_test_session_id = $1 FOR UPDATE', [req.params.id]);
      if (sessionRows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Session not found.' }); }
      const existing = sessionRows[0];
      if (existing.office_id !== req.user.officeId) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your office.' }); }
      if (existing.status !== 'Published') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Only a published session can be postponed.' }); }
      if (newDate !== String(existing.test_date).slice(0, 10)) {
        const { rows: conflictRows } = await client.query(
          `SELECT 1 FROM theory_test_sessions WHERE office_id = $1 AND test_date = $2 AND theory_test_session_id != $3`,
          [existing.office_id, newDate, req.params.id]
        );
        if (conflictRows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Your office already has a session on that date.' }); }
      }
      const { rows: sessRows } = await client.query(
        `UPDATE theory_test_sessions SET test_date = $1, test_time = COALESCE($2, test_time),
                postponed_reason = $3, postponed_at = NOW(), postponed_by_user_id = $4, updated_at = NOW()
         WHERE theory_test_session_id = $5 RETURNING *`,
        [newDate, newTime || null, String(reason).trim(), req.user.userId, req.params.id]
      );
      const session = sessRows[0];
      const { rows: bookings } = await client.query(
        `UPDATE driving_test_bookings SET confirmed_date = $1, updated_at = NOW()
         WHERE theory_session_id = $2 AND test_type = 'Theory' AND status = 'Scheduled' RETURNING *`,
        [newDate, session.theory_test_session_id]
      );
      await client.query('COMMIT');

      for (const bk of bookings) {
        const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [bk.citizen_id])).rows[0];
        if (userRow) {
          await createNotification({
            userId: userRow.user_id, title: 'Theory test postponed', type: 'Status Change',
            message: `Your theory test has been postponed to ${newDate} at ${String(session.test_time).slice(0, 5)}. Reason: ${String(reason).trim()}.`,
          });
        }
      }
      res.json({ session, bookingsMoved: bookings.length });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

/** GET /traffic/test-bookings/:id/theory-test (citizen) — the questions for the citizen's own
 *  Theory booking, WITHOUT correctIndex (never sent to the citizen — see scoring below). Only
 *  available once the session it belongs to is published and the citizen has not already
 *  submitted their answers. */
async function getTheoryTest(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT b.*, s.test_time, s.questions, s.status AS session_status FROM driving_test_bookings b
       LEFT JOIN theory_test_sessions s ON s.theory_test_session_id = b.theory_session_id
       WHERE b.driving_test_booking_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    const booking = rows[0];
    if (booking.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'Not your booking.' });
    if (booking.test_type !== 'Theory') return res.status(400).json({ error: 'Not a theory booking.' });
    if (!booking.theory_session_id || booking.session_status !== 'Published') {
      return res.status(409).json({ error: 'Your theory test has not been published yet.' });
    }
    if (booking.submitted_at) return res.status(409).json({ error: 'You have already submitted this test.' });
    res.json({
      testDate: booking.confirmed_date, testTime: booking.test_time,
      questions: (booking.questions || []).map((q) => ({ question: q.question, options: q.options })),
    });
  } catch (err) { next(err); }
}

/** POST /traffic/test-bookings/:id/submit-answers (citizen) body:{answers:[index,...]} — the
 *  system marks the test itself: "so that system can mark and automated the process ... system
 *  must record the result and tell if citizen pass or fail". Scores correctCount/total*100
 *  (THEORY_PASS_PERCENT decides pass/fail), records it as both the result and the marks, and —
 *  same as before — a Pass auto-creates the Practical booking in the same transaction, now as
 *  'Requested' with only a suggested date (the following day) — see schedulePracticalTest(). */
async function submitTheoryAnswers(req, res, next) {
  try {
    const { answers } = req.body;
    if (!Array.isArray(answers) || answers.length === 0) return res.status(400).json({ error: 'answers must be a non-empty list.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows: bRows } = await client.query(
        `SELECT b.*, s.questions, s.status AS session_status FROM driving_test_bookings b
         LEFT JOIN theory_test_sessions s ON s.theory_test_session_id = b.theory_session_id
         WHERE b.driving_test_booking_id = $1 FOR UPDATE OF b`,
        [req.params.id]
      );
      if (bRows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found.' }); }
      const existing = bRows[0];
      if (existing.citizen_id !== req.user.citizenId) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your booking.' }); }
      if (existing.test_type !== 'Theory' || existing.status !== 'Scheduled') {
        await client.query('ROLLBACK'); return res.status(409).json({ error: 'Cannot submit answers for this booking in its current state.' });
      }
      if (!existing.theory_session_id || existing.session_status !== 'Published') {
        await client.query('ROLLBACK'); return res.status(409).json({ error: 'Your theory test has not been published yet.' });
      }
      if (existing.submitted_at) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'You have already submitted this test.' }); }
      const questions = existing.questions || [];
      if (answers.length !== questions.length) {
        await client.query('ROLLBACK'); return res.status(400).json({ error: `answers must have exactly ${questions.length} entries.` });
      }

      let correct = 0;
      questions.forEach((q, i) => { if (Number(answers[i]) === q.correctIndex) correct += 1; });
      const score = Math.round((correct / questions.length) * 100);
      const result = score >= THEORY_PASS_PERCENT ? 'Passed' : 'Failed';

      const { rows } = await client.query(
        `UPDATE driving_test_bookings SET status = 'Completed', result = $1, marks = $2, answers = $3::jsonb, submitted_at = NOW(), updated_at = NOW()
         WHERE driving_test_booking_id = $4 RETURNING *`,
        [result, score, JSON.stringify(answers.map(Number)), req.params.id]
      );
      const booking = rows[0];
      await syncApplicationStatus(client, { sourceTable: 'driving_test_bookings', sourceId: booking.driving_test_booking_id, status: 'Completed', completed: true });

      // Migration 069: the suggested Practical date is now the day right after the theory
      // sitting ("it should be following day after theory test" — reduced from the three days
      // used before this batch), and the booking lands as 'Requested' with no venue, no start
      // time, and no confirmed_date yet — an officer must supply both before it becomes
      // 'Scheduled' (schedulePracticalTest() below), per "the system before it schedule it
      // should aske officer the location ... and the time they will start."
      let autoScheduledPractical = null;
      if (result === 'Passed') {
        const bookingReference = generateReference('DTB');
        const { rows: practicalRows } = await client.query(
          `INSERT INTO driving_test_bookings (citizen_id, booking_reference, test_type, office_id, requested_date, status, theory_booking_id)
           VALUES ($1,$2,'Practical',$3, (DATE($4) + INTERVAL '1 day'), 'Requested', $5) RETURNING *`,
          [booking.citizen_id, bookingReference, booking.office_id, booking.confirmed_date, booking.driving_test_booking_id]
        );
        autoScheduledPractical = practicalRows[0];
        await indexApplication(client, {
          citizenId: booking.citizen_id, departmentKey: 'traffic', serviceType: 'Practical Driving Test',
          referenceNumber: bookingReference, sourceTable: 'driving_test_bookings', sourceId: autoScheduledPractical.driving_test_booking_id, status: 'Requested',
        });
      }
      await client.query('COMMIT');

      await createNotification({
        userId: req.user.userId, title: `Theory test: ${result}`, type: result === 'Passed' ? 'Approval' : 'Rejection',
        message: `You scored ${score}%. Reference ${booking.booking_reference}.`,
      });
      if (autoScheduledPractical) {
        await createNotification({
          userId: req.user.userId, title: 'Practical driving test requested', type: 'Status Change',
          message: `Reference ${autoScheduledPractical.booking_reference}. Your office will confirm the exact date, time and location shortly (suggested date: ${String(autoScheduledPractical.requested_date).slice(0, 10)}).`,
        });
      }
      res.json({ booking, score, passed: result === 'Passed', autoScheduledPractical });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

/** POST /traffic/test-bookings/:id/schedule-practical (officer) body:{testLocation,
 *  scheduledTime, confirmedDate?} — "the system before it schedule it should aske officer the
 *  location where practical will take place and the time they will start." A Practical booking
 *  auto-created on a Theory pass lands in 'Requested' with only a suggested date (the day after
 *  the theory sitting); it only becomes 'Scheduled' once an officer supplies BOTH a venue and a
 *  start time here. confirmedDate defaults to that suggested date, but an officer may move it
 *  (e.g. if the following day doesn't suit the office) as part of the same step. */
async function schedulePracticalTest(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { testLocation, scheduledTime, confirmedDate } = req.body;
    if (!testLocation || !String(testLocation).trim()) return res.status(400).json({ error: 'testLocation is required.' });
    if (!scheduledTime) return res.status(400).json({ error: 'scheduledTime is required.' });
    const { rows: existingRows } = await db.query(`SELECT * FROM driving_test_bookings WHERE driving_test_booking_id = $1`, [req.params.id]);
    if (existingRows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    const existing = existingRows[0];
    if (existing.test_type !== 'Practical' || existing.status !== 'Requested') {
      return res.status(409).json({ error: 'Cannot schedule this booking in its current state.' });
    }
    let dateToUse = existing.requested_date;
    if (confirmedDate) {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (confirmedDate < todayStr) return res.status(400).json({ error: 'confirmedDate must be today or a future date.' });
      dateToUse = confirmedDate;
    }
    const { rows } = await db.query(
      `UPDATE driving_test_bookings SET status = 'Scheduled', confirmed_date = $1, test_location = $2, scheduled_time = $3, updated_at = NOW()
       WHERE driving_test_booking_id = $4 RETURNING *`,
      [dateToUse, String(testLocation).trim(), scheduledTime, req.params.id]
    );
    const bk = rows[0];
    await syncApplicationStatus(db, { sourceTable: 'driving_test_bookings', sourceId: bk.driving_test_booking_id, status: 'Scheduled' });
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [bk.citizen_id])).rows[0];
    if (userRow) {
      await createNotification({
        userId: userRow.user_id, title: 'Practical driving test scheduled', type: 'Status Change',
        message: `Reference ${bk.booking_reference}: ${String(bk.confirmed_date).slice(0, 10)} at ${String(bk.scheduled_time).slice(0, 5)}, ${bk.test_location}.`,
      });
    }
    res.json({ booking: bk });
  } catch (err) { next(err); }
}

/** POST /traffic/test-bookings/:id/postpone (officer) body:{newDate, newTime?, reason} —
 *  "the system must allow officer to postpone test because someday weather may be bad or move."
 *  Only for a Practical booking that is already 'Scheduled' (a published Theory sitting is
 *  postponed through its SESSION instead — postponeTheorySession below — since many citizens
 *  share one sitting). Stays 'Scheduled', just moves the date and/or time, with a short audit
 *  trail of who postponed it, when, and why — the same shape as rejection_reason elsewhere. */
async function postponeTestBooking(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { newDate, newTime, reason } = req.body;
    if (!newDate) return res.status(400).json({ error: 'newDate is required.' });
    if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'A reason is required.' });
    const todayStr = new Date().toISOString().slice(0, 10);
    if (newDate < todayStr) return res.status(400).json({ error: 'newDate must be today or a future date.' });
    const { rows: existingRows } = await db.query(`SELECT * FROM driving_test_bookings WHERE driving_test_booking_id = $1`, [req.params.id]);
    if (existingRows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    const existing = existingRows[0];
    if (existing.test_type !== 'Practical' || existing.status !== 'Scheduled') {
      return res.status(409).json({ error: 'Cannot postpone this booking in its current state.' });
    }
    const { rows } = await db.query(
      `UPDATE driving_test_bookings SET confirmed_date = $1, scheduled_time = COALESCE($2, scheduled_time),
              postponed_reason = $3, postponed_at = NOW(), postponed_by_user_id = $4, updated_at = NOW()
       WHERE driving_test_booking_id = $5 RETURNING *`,
      [newDate, newTime || null, String(reason).trim(), req.user.userId, req.params.id]
    );
    const bk = rows[0];
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [bk.citizen_id])).rows[0];
    if (userRow) {
      await createNotification({
        userId: userRow.user_id, title: 'Practical driving test postponed', type: 'Status Change',
        message: `Reference ${bk.booking_reference} has been postponed to ${String(bk.confirmed_date).slice(0, 10)}${bk.scheduled_time ? ` at ${String(bk.scheduled_time).slice(0, 5)}` : ''}. Reason: ${String(reason).trim()}.`,
      });
    }
    res.json({ booking: bk });
  } catch (err) { next(err); }
}

/** Reuses the citizen's own National ID photo/fingerprints (migrations 007/034/036) rather than
 *  capturing anything fresh — "the system must reuse biomatrix that captured during id
 *  application ... for license and learners". Best-effort: a citizen whose National ID card has
 *  no stored photo/biometrics still gets their Learner's Permit, just without those references
 *  filled in, exactly the same resilience already used for passports with no stored ID photo. */
async function autoGenerateLearnerPermit(client, citizenId, practicalBookingId) {
  const { rows: idRows } = await client.query(
    `SELECT photo_reference, biometric_reference_left, biometric_reference_right
     FROM national_id_cards WHERE citizen_id = $1 AND production_status = 'Collected' ORDER BY approval_date DESC LIMIT 1`,
    [citizenId]
  );
  const idCapture = idRows[0] || {};
  const referenceNumber = generateReference('TR');
  const licenceNumber = genNumber('LP');
  const { rows } = await client.query(
    `INSERT INTO traffic_records
        (citizen_id, application_reference, service_type, status, licence_number, issue_date, expiry_date,
         photo_reference, biometric_reference_left, biometric_reference_right, photo_source, source_test_booking_id)
     VALUES ($1,$2,'Learner Permit','Approved',$3,CURRENT_DATE,CURRENT_DATE + INTERVAL '2 years',$4,$5,$6,'id',$7)
     RETURNING *`,
    [citizenId, referenceNumber, licenceNumber, idCapture.photo_reference || null, idCapture.biometric_reference_left || null, idCapture.biometric_reference_right || null, practicalBookingId]
  );
  const permit = rows[0];
  await indexApplication(client, {
    citizenId, departmentKey: 'traffic', serviceType: 'Learner Permit', referenceNumber,
    sourceTable: 'traffic_records', sourceId: permit.traffic_record_id, status: 'Approved',
  });
  return permit;
}

async function listTestBookings(req, res, next) {
  try {
    if (isOfficer(req)) {
      const { rows } = await db.query(
        `SELECT b.*, c.first_name, c.last_name, s.test_time AS theory_test_time FROM driving_test_bookings b
         JOIN citizens c ON c.citizen_id = b.citizen_id
         LEFT JOIN theory_test_sessions s ON s.theory_test_session_id = b.theory_session_id
         ORDER BY b.requested_at DESC`
      );
      return res.json({ bookings: rows });
    }
    if (!req.user.citizenId) return res.json({ bookings: [] });
    const { rows } = await db.query(
      `SELECT b.*, s.test_time AS theory_test_time FROM driving_test_bookings b
       LEFT JOIN theory_test_sessions s ON s.theory_test_session_id = b.theory_session_id
       WHERE b.citizen_id = $1 ORDER BY b.requested_at DESC`,
      [req.user.citizenId]
    );
    res.json({ bookings: rows });
  } catch (err) { next(err); }
}

async function getTestBooking(req, res, next) {
  try {
    const { rows } = await db.query(`SELECT * FROM driving_test_bookings WHERE driving_test_booking_id = $1`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    const booking = rows[0];
    if (!isOfficer(req) && booking.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'Not your booking.' });
    res.json({ booking });
  } catch (err) { next(err); }
}

/** POST /traffic/test-bookings/:id/record-result body:{result, marks?} (officer) — marks (0-100)
 *  is the officer's recorded score, kept alongside the existing Pass/Fail result which stays the
 *  authoritative gate. Refuses to run on a Theory booking (self-marked automatically instead —
 *  see submitTheoryAnswers) or a Practical booking with no location set — though by the time a
 *  Practical booking reaches 'Scheduled' at all it was scheduled with a location in the same
 *  step (schedulePracticalTest), so this check is now just defense-in-depth. A Practical Pass
 *  auto-generates the Learner's Permit, in the same transaction as the result itself, so the
 *  officer's one click produces the result and whatever follows from it together. */
async function recordTestResult(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { result, marks } = req.body;
    if (!['Passed', 'Failed'].includes(result)) return res.status(400).json({ error: "result must be 'Passed' or 'Failed'." });
    let marksValue = null;
    if (marks !== undefined && marks !== null && marks !== '') {
      marksValue = Number(marks);
      if (Number.isNaN(marksValue) || marksValue < 0 || marksValue > 100) {
        return res.status(400).json({ error: 'marks must be a number between 0 and 100.' });
      }
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query('SELECT * FROM driving_test_bookings WHERE driving_test_booking_id = $1 FOR UPDATE', [req.params.id]);
      if (existingRows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Booking not found.' }); }
      const existing = existingRows[0];
      if (existing.status !== 'Scheduled') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Cannot record a result for this booking in its current state.' });
      }
      if (existing.test_type === 'Theory') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The theory test is multiple choice and marks itself automatically once the citizen submits their answers — there is nothing to record manually.' });
      }
      if (existing.test_type === 'Practical' && !existing.test_location) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Enter the practical test location before recording a result.' });
      }

      const { rows } = await client.query(
        `UPDATE driving_test_bookings SET status = 'Completed', result = $1, marks = $2, updated_at = NOW()
         WHERE driving_test_booking_id = $3 RETURNING *`,
        [result, marksValue, req.params.id]
      );
      const booking = rows[0];
      await syncApplicationStatus(client, { sourceTable: 'driving_test_bookings', sourceId: booking.driving_test_booking_id, status: 'Completed', completed: true });

      // Only a Practical booking ever reaches here now — a Theory result is refused above and
      // produced automatically by submitTheoryAnswers() instead. A Practical Pass still
      // auto-generates the Learner's Permit, exactly as before.
      let generatedPermit = null;
      if (result === 'Passed' && booking.test_type === 'Practical') {
        generatedPermit = await autoGenerateLearnerPermit(client, booking.citizen_id, booking.driving_test_booking_id);
      }

      await client.query('COMMIT');

      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [booking.citizen_id])).rows[0];
      if (userRow) {
        await createNotification({ userId: userRow.user_id, title: `${booking.test_type} test: ${result}`, message: `Reference ${booking.booking_reference}.`, type: result === 'Passed' ? 'Approval' : 'Rejection' });
        if (generatedPermit) {
          await createNotification({
            userId: userRow.user_id, title: "Learner's Permit issued",
            message: `${generatedPermit.licence_number}, valid until ${String(generatedPermit.expiry_date).slice(0, 10)}.`, type: 'Approval',
          });
        }
      }
      res.json({ booking, generatedPermit });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

async function cancelTestBooking(req, res, next) {
  try {
    const { rows: existing } = await db.query(`SELECT * FROM driving_test_bookings WHERE driving_test_booking_id = $1`, [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    if (!isOfficer(req) && existing[0].citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'Not your booking.' });
    const { rows } = await db.query(
      `UPDATE driving_test_bookings SET status = 'Cancelled', updated_at = NOW()
       WHERE driving_test_booking_id = $1 AND status IN ('Requested', 'Scheduled') RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot cancel this booking in its current state.' });
    await syncApplicationStatus(db, { sourceTable: 'driving_test_bookings', sourceId: rows[0].driving_test_booking_id, status: 'Cancelled', completed: true });
    res.json({ booking: rows[0] });
  } catch (err) { next(err); }
}

async function rejectTestBooking(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A reason is required.' });
    const { rows } = await db.query(
      `UPDATE driving_test_bookings SET status = 'Rejected', rejection_reason = $1, updated_at = NOW()
       WHERE driving_test_booking_id = $2 AND status IN ('Requested', 'Scheduled') RETURNING *`,
      [reason, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Cannot reject this booking in its current state.' });
    await syncApplicationStatus(db, { sourceTable: 'driving_test_bookings', sourceId: rows[0].driving_test_booking_id, status: 'Rejected', completed: true });
    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [rows[0].citizen_id])).rows[0];
    if (userRow) await createNotification({ userId: userRow.user_id, title: 'Test booking rejected', message: reason, type: 'Rejection' });
    res.json({ booking: rows[0] });
  } catch (err) { next(err); }
}

// ============================================================================================
// ROADWORTHINESS TEST & CERTIFICATE OF FITNESS (COF)
// ============================================================================================

const vehicleInspectionsController = makeDepartmentController({
  table: 'vehicle_inspections',
  idColumn: 'vehicle_inspection_id',
  deptKey: 'traffic',
  officerRoleKey: 'traffic_officer',
  refPrefix: 'COF',
  serviceTypes: ['Roadworthiness Test & Certificate of Fitness'],
  finalStatuses: ['Rejected', 'Approved'], // Approved IS the end state here — no physical collection step
  beforeApply: async (req) => {
    if (!req.body.vehicleRegistrationNumber) return { error: 'vehicleRegistrationNumber is required.' };
    if (!req.body.officeId) return { error: 'officeId is required — choose an inspection centre.' };
    if (!(await citizenHasApprovedTrafficRecord(req.user.citizenId, 'vehicle_registration_number', req.body.vehicleRegistrationNumber))) {
      return { error: 'No registered vehicle with that registration number was found on your record.' };
    }
    return null;
  },
  extraInsertFields: [
    { column: 'vehicle_registration_number', fromBody: 'vehicleRegistrationNumber' },
    { column: 'office_id', fromBody: 'officeId' },
  ],
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'check-documents': { from: 'Under Review', to: 'Documents Checked' },
    'process': { from: 'Documents Checked', to: 'Processing' },
    'approve': {
      from: 'Processing', to: 'Approved',
      extra: () => ({
        setSql: `cof_number = $3, cof_issue_date = CURRENT_DATE, cof_expiry_date = CURRENT_DATE + INTERVAL '1 year'`,
        params: [genNumber('COF')],
      }),
    },
  },
});

// ============================================================================================
// TRANSPORT OPERATING PERMIT (new or renewal)
// ============================================================================================

const transportPermitsController = makeDepartmentController({
  table: 'transport_operating_permits',
  idColumn: 'transport_operating_permit_id',
  deptKey: 'traffic',
  officerRoleKey: 'traffic_officer',
  refPrefix: 'TOP',
  serviceTypes: ['New', 'Renewal'],
  finalStatuses: ['Rejected', 'Approved'],
  beforeApply: async (req) => {
    const b = req.body;
    if (!b.vehicleRegistrationNumber) return { error: 'vehicleRegistrationNumber is required.' };
    if (!['A', 'B', 'C', 'D', 'E', 'F'].includes(b.permitCategory)) return { error: 'permitCategory must be one of A, B, C, D, E, F.' };
    if (!b.operatingRouteOrArea) return { error: 'operatingRouteOrArea is required — the operating area must be known before a permit can be granted.' };
    if (b.serviceType === 'Renewal' && !b.previousPermitNumber) return { error: 'previousPermitNumber is required for a renewal.' };
    const { rows } = await db.query(
      `SELECT 1 FROM vehicle_inspections WHERE citizen_id = $1 AND vehicle_registration_number = $2
       AND status = 'Approved' AND cof_expiry_date >= CURRENT_DATE`,
      [req.user.citizenId, b.vehicleRegistrationNumber]
    );
    if (rows.length === 0) return { error: 'A valid, unexpired Certificate of Fitness for this vehicle is required before a transport operating permit can be issued.' };
    return null;
  },
  extraInsertFields: [
    { column: 'vehicle_registration_number', fromBody: 'vehicleRegistrationNumber' },
    { column: 'permit_category', fromBody: 'permitCategory' },
    { column: 'operating_route_or_area', fromBody: 'operatingRouteOrArea' },
    { column: 'previous_permit_number', fromBody: 'previousPermitNumber' },
  ],
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'check-documents': { from: 'Under Review', to: 'Documents Checked' },
    'process': { from: 'Documents Checked', to: 'Processing' },
    'approve': {
      from: 'Processing', to: 'Approved',
      extra: () => ({
        setSql: `permit_number = $3, valid_from = CURRENT_DATE, valid_until = CURRENT_DATE + INTERVAL '1 year'`,
        params: [genNumber('TOP')],
      }),
    },
  },
});

// ============================================================================================
// DRIVING INSTRUCTOR & EXAMINER CERTIFICATION — admin registry, no citizen applicant
// ============================================================================================

async function createDrivingInstructor(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { fullName, certificationType, drivingSchoolOrAuthority, districtId, notes } = req.body;
    if (!fullName || !certificationType) return res.status(400).json({ error: 'fullName and certificationType are required.' });
    if (!['Instructor', 'Examiner'].includes(certificationType)) return res.status(400).json({ error: "certificationType must be 'Instructor' or 'Examiner'." });
    const licenceOrCertificateNumber = generateReference('DIC');
    const { rows } = await db.query(
      `INSERT INTO driving_instructor_registrations (full_name, certification_type, driving_school_or_authority, district_id, licence_or_certificate_number, notes, registered_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [fullName, certificationType, drivingSchoolOrAuthority || null, districtId || null, licenceOrCertificateNumber, notes || null, req.user.userId]
    );
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('traffic'), action: 'DRIVING_INSTRUCTOR_REGISTERED', targetType: 'driving_instructor_registration', targetId: rows[0].driving_instructor_registration_id });
    res.status(201).json({ drivingInstructor: rows[0] });
  } catch (err) { next(err); }
}

async function listDrivingInstructors(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { status, districtId } = req.query;
    const { rows } = await db.query(
      `SELECT i.*, d.name AS district_name FROM driving_instructor_registrations i
       LEFT JOIN districts d ON d.district_id = i.district_id
       WHERE ($1::text IS NULL OR i.status = $1) AND ($2::int IS NULL OR i.district_id = $2)
       ORDER BY i.registered_at DESC`,
      [status || null, districtId || null]
    );
    res.json({ drivingInstructors: rows });
  } catch (err) { next(err); }
}

async function getDrivingInstructor(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { rows } = await db.query(
      `SELECT i.*, d.name AS district_name FROM driving_instructor_registrations i
       LEFT JOIN districts d ON d.district_id = i.district_id WHERE i.driving_instructor_registration_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Driving instructor registration not found.' });
    res.json({ drivingInstructor: rows[0] });
  } catch (err) { next(err); }
}

async function updateDrivingInstructorStatus(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { status, notes } = req.body;
    if (!['Registered', 'Suspended', 'Revoked'].includes(status)) return res.status(400).json({ error: "status must be 'Registered', 'Suspended' or 'Revoked'." });
    const { rows } = await db.query(
      `UPDATE driving_instructor_registrations SET status = $1, notes = COALESCE($2, notes),
          status_changed_by_user_id = $3, status_changed_at = NOW(), updated_at = NOW()
       WHERE driving_instructor_registration_id = $4 RETURNING *`,
      [status, notes || null, req.user.userId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Driving instructor registration not found.' });
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('traffic'), action: `DRIVING_INSTRUCTOR_${status.toUpperCase()}`, targetType: 'driving_instructor_registration', targetId: Number(req.params.id) });
    res.json({ drivingInstructor: rows[0] });
  } catch (err) { next(err); }
}

module.exports = {
  requestTestBooking, listTestBookings, getTestBooking, schedulePracticalTest, postponeTestBooking,
  recordTestResult, cancelTestBooking, rejectTestBooking,
  upsertTheorySession, listTheorySessions, publishTheorySession, postponeTheorySession, getTheoryTest, submitTheoryAnswers,
  vehicleInspectionsController,
  transportPermitsController,
  createDrivingInstructor, listDrivingInstructors, getDrivingInstructor, updateDrivingInstructorStatus,
};
