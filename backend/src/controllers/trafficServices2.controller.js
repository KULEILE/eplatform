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
 *     schedulePracticalBulk() with a venue, date AND a start time before it becomes 'Scheduled'.
 *
 *     Batch 25 changed HOW that scheduling happens: the original version of this let an officer
 *     open any one 'Requested' Practical booking and set ITS OWN date/time/venue, one citizen at
 *     a time — "on the practical schedule lets avoid individual schedule officer must schedule
 *     for once and that apply to all citizens passed test." That per-citizen shape was exactly
 *     the same fairness risk already called out for the Theory test (migration 071/Batch 23): an
 *     officer could see a name they don't like and quietly give that one person a worse date,
 *     time, or venue than everyone else, or simply never get around to scheduling them. There is
 *     no legitimate reason for two citizens who both passed their Theory test at the same office
 *     to need different Practical-test logistics, so schedulePracticalBulk() replaces the old
 *     per-booking endpoint entirely: an officer sets ONE date, ONE start time, and ONE venue, and
 *     it is applied identically to EVERY 'Requested' Practical booking at their own office in a
 *     single action — there is no way to schedule just one citizen, or to give one a different
 *     time than the rest.
 *
 *     An already-scheduled Practical booking, or an already-published Theory session, can also be
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
 *
 *     Migration 070 (Batch 22) added a DURATION to the Theory sitting: "this theory test must
 *     have duration and it must close automatically when the time is up." Confirmed with the
 *     user: one shared exam window for everyone booked that day/office, not a personal timer per
 *     citizen — the officer already sets a single start TIME for the whole sitting, so
 *     duration_minutes just extends that into a window [test_time, test_time + duration). Access
 *     is refused before the window opens; once it closes, EVERY still-unsubmitted booking in it
 *     is auto-scored and finalized, whether or not anyone is around to click Submit — see
 *     finalizeTheoryBooking() (the one scoring/finalize path used by a manual submit, a
 *     client-triggered timeout, AND the server-side sweep), scoreTheoryAnswers(), and
 *     sweepExpiredTheorySittings() (run at the top of listTestBookings so the officer's and a
 *     citizen's own list both self-heal on every load, with no background job needed). A
 *     citizen's answer choices are now saved continuously while they work (saveTheoryProgress,
 *     POST .../save-progress) rather than only at the end, specifically so an auto-close has
 *     something real to score even if their browser tab died before they hit Submit — and so a
 *     submission arriving noticeably after the deadline is scored off that saved history instead
 *     of trusting whatever is in the late request's own body.
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
// Passed and Failed. Originally defaulted to 70 (not specified in the original request); changed
// to 50 per explicit instruction.
const THEORY_PASS_PERCENT = 50;

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

/** Batch 22: "this theory test must have duration and it must close automatically when the time
 *  is up" — scores a set of answers against a question set the same way everywhere it's needed
 *  (a manual submit, a timeout, or the lazy sweep), fixing a real bug the old inline version had:
 *  `Number(null) === 0` is `true` in JavaScript, so an unanswered question would have been
 *  scored as correct whenever that question's correctIndex happened to be 0. Explicitly
 *  treating null/undefined as "not answered" avoids that. `answers` may be shorter than
 *  `questions`, or entirely missing (a citizen who never saved any progress) — both just score
 *  as unanswered, the same as leaving an exam paper blank. */
function scoreTheoryAnswers(questions, answers) {
  const arr = Array.isArray(answers) ? answers : [];
  let correct = 0;
  questions.forEach((q, i) => {
    const a = arr[i];
    if (a !== null && a !== undefined && Number(a) === q.correctIndex) correct += 1;
  });
  const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
  const result = score >= THEORY_PASS_PERCENT ? 'Passed' : 'Failed';
  const normalizedAnswers = questions.map((_, i) => (arr[i] === null || arr[i] === undefined ? null : Number(arr[i])));
  return { score, result, normalizedAnswers };
}

/** The one place a Theory booking's answers become final — used by a citizen's own manual
 *  submit (submitTheoryAnswers), by the automatic close-out a citizen's own client triggers when
 *  its countdown reaches zero (also submitTheoryAnswers, just past the deadline), by opening an
 *  already-expired sitting (getTheoryTest), and by the server-side safety net that finalizes a
 *  sitting even if nobody is around to trigger either of those (sweepExpiredTheorySittings).
 *  Every path runs the exact same scoring, status transition, and Practical-auto-create logic,
 *  so "closes automatically when the time is up" produces an identical result to clicking
 *  Submit, never a lesser one. Re-checks and locks the booking itself (FOR UPDATE) so two of
 *  these paths racing each other (e.g. the sweep and the citizen's own timeout, both firing at
 *  once) can't double-finalize or double-create a Practical booking. */
async function finalizeTheoryBooking(bookingId, { timedOut = false } = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: bRows } = await client.query(
      `SELECT b.*, s.questions FROM driving_test_bookings b
       LEFT JOIN theory_test_sessions s ON s.theory_test_session_id = b.theory_session_id
       WHERE b.driving_test_booking_id = $1 FOR UPDATE OF b`,
      [bookingId]
    );
    if (bRows.length === 0) { await client.query('ROLLBACK'); return { notFound: true }; }
    const existing = bRows[0];
    if (existing.status !== 'Scheduled' || existing.submitted_at) {
      // Already finalized by a path that won the race (or simply ran first) — nothing left to
      // do; hand back what's already there instead of erroring.
      await client.query('ROLLBACK');
      return { booking: existing, score: existing.marks, passed: existing.result === 'Passed', autoScheduledPractical: null, alreadyFinalized: true };
    }
    const questions = existing.questions || [];
    const { score, result, normalizedAnswers } = scoreTheoryAnswers(questions, existing.answers);

    const { rows } = await client.query(
      `UPDATE driving_test_bookings SET status = 'Completed', result = $1, marks = $2, answers = $3::jsonb, submitted_at = NOW(), updated_at = NOW()
       WHERE driving_test_booking_id = $4 RETURNING *`,
      [result, score, JSON.stringify(normalizedAnswers), bookingId]
    );
    const booking = rows[0];
    await syncApplicationStatus(client, { sourceTable: 'driving_test_bookings', sourceId: booking.driving_test_booking_id, status: 'Completed', completed: true });

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

    const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [booking.citizen_id])).rows[0];
    if (userRow) {
      await createNotification({
        userId: userRow.user_id, title: `Theory test: ${result}`, type: result === 'Passed' ? 'Approval' : 'Rejection',
        message: timedOut
          ? `Your test window closed and was automatically submitted. You scored ${score}%. Reference ${booking.booking_reference}.`
          : `You scored ${score}%. Reference ${booking.booking_reference}.`,
      });
      if (autoScheduledPractical) {
        await createNotification({
          userId: userRow.user_id, title: 'Practical driving test requested', type: 'Status Change',
          message: `Reference ${autoScheduledPractical.booking_reference}. Your office will confirm the exact date, time and location shortly (suggested date: ${String(autoScheduledPractical.requested_date).slice(0, 10)}).`,
        });
      }
    }
    return { booking, score, passed: result === 'Passed', autoScheduledPractical };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Runs before building any Theory/Practical bookings list so "closes automatically when the
 *  time is up" holds even when nobody ever opens the specific test again to trigger it — any
 *  Scheduled, unsubmitted Theory booking whose sitting's window has already elapsed gets
 *  finalized here exactly like a timeout inside getTheoryTest would, scored off whatever answers
 *  were last saved via saveTheoryProgress (or 0 if the citizen never saved anything — a true
 *  no-show). There's no real background job/cron in this app, so this lazy-sweep-on-read is the
 *  lightweight stand-in: every load of the bookings list (officer or citizen) self-heals any
 *  sitting that's overdue. officeId/citizenId just scope which bookings are eligible to be swept
 *  by this call — null means no restriction on that column. */
async function sweepExpiredTheorySittings({ officeId = null, citizenId = null } = {}) {
  const { rows } = await db.query(
    `SELECT b.driving_test_booking_id FROM driving_test_bookings b
     JOIN theory_test_sessions s ON s.theory_test_session_id = b.theory_session_id
     WHERE b.test_type = 'Theory' AND b.status = 'Scheduled' AND b.submitted_at IS NULL
       AND s.status = 'Published' AND s.duration_minutes IS NOT NULL AND s.test_time IS NOT NULL
       AND (((s.test_date + s.test_time) AT TIME ZONE 'Africa/Maseru') + (s.duration_minutes || ' minutes')::interval) < NOW()
       AND ($1::int IS NULL OR b.office_id = $1)
       AND ($2::int IS NULL OR b.citizen_id = $2)`,
    [officeId, citizenId]
  );
  for (const row of rows) {
    try {
      await finalizeTheoryBooking(row.driving_test_booking_id, { timedOut: true });
    } catch (err) {
      // Don't let one booking's finalize failure break the whole listing — the next list or
      // getTheoryTest call simply retries it.
      // eslint-disable-next-line no-console
      console.error(`Failed to auto-close theory booking ${row.driving_test_booking_id}:`, err.message);
    }
  }
}

/** POST /traffic/theory-sessions (officer) body:{testDate, testTime?, durationMinutes?,
 *  questions} — creates the session for the officer's own office on that date if none exists
 *  yet, or updates it (while still Draft — "officer must set time" and a duration, and author
 *  the shared question set before publishing). A Published session is locked: citizens may
 *  already be relying on exactly these questions (and this window). */
async function upsertTheorySession(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    if (!req.user.officeId) return res.status(400).json({ error: 'Your account has no office assigned — cannot manage theory sessions.' });
    const { testDate, testTime, durationMinutes, questions } = req.body;
    if (!testDate) return res.status(400).json({ error: 'testDate is required.' });
    if (questions !== undefined) {
      const err = validateQuestions(questions);
      if (err) return res.status(400).json({ error: err });
    }
    let durationValue;
    if (durationMinutes !== undefined && durationMinutes !== null && durationMinutes !== '') {
      durationValue = Number(durationMinutes);
      if (!Number.isInteger(durationValue) || durationValue <= 0 || durationValue > 240) {
        return res.status(400).json({ error: 'durationMinutes must be a whole number of minutes between 1 and 240.' });
      }
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
        `UPDATE theory_test_sessions SET test_time = COALESCE($1, test_time), duration_minutes = COALESCE($2, duration_minutes),
                questions = COALESCE($3::jsonb, questions), updated_at = NOW()
         WHERE theory_test_session_id = $4 RETURNING *`,
        [testTime || null, durationValue ?? null, questions ? JSON.stringify(normalizeQuestions(questions)) : null, existingRows[0].theory_test_session_id]
      ));
    } else {
      ({ rows } = await db.query(
        `INSERT INTO theory_test_sessions (office_id, test_date, test_time, duration_minutes, questions, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
        [req.user.officeId, testDate, testTime || null, durationValue ?? null, questions ? JSON.stringify(normalizeQuestions(questions)) : null, req.user.userId]
      ));
    }
    res.status(201).json({ session: rows[0] });
  } catch (err) { next(err); }
}

/** GET /traffic/theory-sessions (officer) — every session for the officer's own office, newest
 *  date first, with a count of how many Theory bookings are waiting on each one, plus the
 *  computed close time (test_time + duration_minutes) so the officer can see the full window at
 *  a glance without doing the arithmetic themselves. */
async function listTheorySessions(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    if (!req.user.officeId) return res.json({ sessions: [] });
    const { rows } = await db.query(
      `SELECT s.*,
              CASE WHEN s.test_time IS NOT NULL AND s.duration_minutes IS NOT NULL
                   THEN (s.test_time + (s.duration_minutes || ' minutes')::interval)::time
                   ELSE NULL END AS window_closes_time,
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
      if (!existing.duration_minutes) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Set a duration before publishing.' }); }
      if (!existing.questions || existing.questions.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Add at least one question before publishing.' }); }

      const { rows: sessRows } = await client.query(
        `UPDATE theory_test_sessions SET status = 'Published', published_by_user_id = $1, published_at = NOW(), updated_at = NOW()
         WHERE theory_test_session_id = $2
         RETURNING *, (test_time + (duration_minutes || ' minutes')::interval)::time AS window_closes_time`,
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
            message: `Your theory test on ${String(session.test_date).slice(0, 10)} is open from ${String(session.test_time).slice(0, 5)} to ${String(session.window_closes_time).slice(0, 5)} — you can take it any time during that window, and it will close automatically at the end.`,
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

/** POST /traffic/theory-sessions/:id/cancel (officer) body:{reason} — Batch 23: "enable the
 *  traffic officer to be able cancel test and set the new one." Deliberately scoped to the whole
 *  shared SESSION, never to one citizen's individual booking — the user was explicit about why:
 *  "what we must avoid is to allow office to deal with individuals because he may see the name of
 *  person he do not like and keep setting new test or difficult one for specific one." Cancelling
 *  always affects every citizen sitting that day uniformly; there is no endpoint anywhere that
 *  lets an officer single out one citizen's Theory booking at all, by design.
 *
 *  Different from postponeTheorySession() above: Postpone keeps the locked question set and just
 *  moves the date/time, for when the sitting itself is still fine, just needs to happen at a
 *  different time. Cancel is for when the session itself needs to be scrapped and redone — it
 *  reverts the session back to 'Draft' (no new status value needed: an unpublished session IS a
 *  draft, whether brand new or reopened) so the officer "sets the new one" through the exact same
 *  editing/publishing flow a brand-new session already uses (upsertTheorySession /
 *  publishTheorySession) — no separate "create replacement" endpoint needed. Every citizen still
 *  waiting (Scheduled, not yet submitted) is unlinked back to "awaiting officer to publish" —
 *  exactly how they looked before any session existed for that date — and notified. Anyone who
 *  already took and was graded under the old session (status is 'Completed' by then, so this
 *  WHERE clause never touches them, same as postponeTheorySession's) keeps that result untouched:
 *  cancelling a session afterward for an unrelated reason shouldn't retroactively void an
 *  already-recorded outcome. */
async function cancelTheorySession(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { reason } = req.body;
    if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'A reason is required.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows: sessionRows } = await client.query('SELECT * FROM theory_test_sessions WHERE theory_test_session_id = $1 FOR UPDATE', [req.params.id]);
      if (sessionRows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Session not found.' }); }
      const existing = sessionRows[0];
      if (existing.office_id !== req.user.officeId) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Not your office.' }); }
      if (existing.status !== 'Published') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Only a published session can be cancelled.' }); }

      const { rows: sessRows } = await client.query(
        `UPDATE theory_test_sessions SET status = 'Draft', published_by_user_id = NULL, published_at = NULL,
                cancelled_reason = $1, cancelled_at = NOW(), cancelled_by_user_id = $2, updated_at = NOW()
         WHERE theory_test_session_id = $3 RETURNING *`,
        [String(reason).trim(), req.user.userId, req.params.id]
      );
      const session = sessRows[0];
      const { rows: bookings } = await client.query(
        `UPDATE driving_test_bookings SET theory_session_id = NULL, updated_at = NOW()
         WHERE theory_session_id = $1 AND test_type = 'Theory' AND status = 'Scheduled' RETURNING *`,
        [session.theory_test_session_id]
      );
      await client.query('COMMIT');

      for (const bk of bookings) {
        const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [bk.citizen_id])).rows[0];
        if (userRow) {
          await createNotification({
            userId: userRow.user_id, title: 'Theory test cancelled', type: 'Status Change',
            message: `Your theory test sitting on ${String(session.test_date).slice(0, 10)} has been cancelled. Reason: ${String(reason).trim()}. You'll be notified again once a new one is published for that date.`,
          });
        }
      }
      res.json({ session, bookingsAffected: bookings.length });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

/** GET /traffic/test-bookings/:id/theory-test (citizen) — the questions for the citizen's own
 *  Theory booking, WITHOUT correctIndex (never sent to the citizen — see scoring below). Only
 *  available once the session it belongs to is published, the shared window has actually
 *  opened, and the citizen has not already submitted their answers. If the window has already
 *  CLOSED by the time the citizen opens this (they never got around to it, or their last visit
 *  was before the deadline and this is a fresh page load after), it auto-finalizes the booking
 *  right here — via the same finalizeTheoryBooking() every other close path uses — and hands
 *  back the result directly instead of a bare error. windowOpensAt/windowClosesAt/serverNow are
 *  all computed by Postgres in this one query so the countdown the citizen's browser renders is
 *  anchored to the server's clock, not its own. A legacy session with no duration_minutes set
 *  (shouldn't happen for anything published after this batch, since publish now requires it) is
 *  treated as having no window at all — open indefinitely once published. */
async function getTheoryTest(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT b.*, s.test_time, s.duration_minutes, s.questions, s.status AS session_status,
              ((s.test_date + s.test_time) AT TIME ZONE 'Africa/Maseru') AS window_opens_at,
              CASE WHEN s.duration_minutes IS NOT NULL AND s.test_time IS NOT NULL
                   THEN (((s.test_date + s.test_time) AT TIME ZONE 'Africa/Maseru') + (s.duration_minutes || ' minutes')::interval)
                   ELSE NULL END AS window_closes_at,
              NOW() AS server_now
       FROM driving_test_bookings b
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

    const now = booking.server_now;
    if (booking.window_opens_at && now < booking.window_opens_at) {
      return res.status(409).json({
        error: `Your theory test opens at ${String(booking.test_time).slice(0, 5)} on ${String(booking.confirmed_date).slice(0, 10)} — it isn't open yet.`,
        windowOpensAt: booking.window_opens_at, serverNow: now,
      });
    }
    if (booking.window_closes_at && now >= booking.window_closes_at) {
      const outcome = await finalizeTheoryBooking(booking.driving_test_booking_id, { timedOut: true });
      if (outcome.notFound) return res.status(404).json({ error: 'Booking not found.' });
      return res.json({
        timedOut: true, booking: outcome.booking, score: outcome.score, passed: outcome.passed,
        autoScheduledPractical: outcome.autoScheduledPractical,
      });
    }

    res.json({
      testDate: booking.confirmed_date, testTime: booking.test_time,
      questions: (booking.questions || []).map((q) => ({ question: q.question, options: q.options })),
      answers: booking.answers || null,
      windowOpensAt: booking.window_opens_at, windowClosesAt: booking.window_closes_at, serverNow: now,
    });
  } catch (err) { next(err); }
}

/** POST /traffic/test-bookings/:id/save-progress (citizen) body:{answers:[index|null,...]} —
 *  "it must close automatically when the time is up" only produces a meaningful score if there's
 *  something real to score, so the frontend calls this every time the citizen picks or changes
 *  an answer, not just once at the end. Refused once the window has closed, same reasoning as
 *  the late-submit guard in submitTheoryAnswers below: once the deadline passes, nothing new can
 *  be written into `answers` by the citizen, from either endpoint, so a late submit can only be
 *  scored off what was already saved before the buzzer. */
async function saveTheoryProgress(req, res, next) {
  try {
    const { answers } = req.body;
    if (!Array.isArray(answers)) return res.status(400).json({ error: 'answers must be a list.' });
    const { rows } = await db.query(
      `SELECT b.*, s.questions, s.status AS session_status,
              CASE WHEN s.duration_minutes IS NOT NULL AND s.test_time IS NOT NULL
                   THEN (((s.test_date + s.test_time) AT TIME ZONE 'Africa/Maseru') + (s.duration_minutes || ' minutes')::interval)
                   ELSE NULL END AS window_closes_at,
              NOW() AS server_now
       FROM driving_test_bookings b
       LEFT JOIN theory_test_sessions s ON s.theory_test_session_id = b.theory_session_id
       WHERE b.driving_test_booking_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    const existing = rows[0];
    if (existing.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'Not your booking.' });
    if (existing.test_type !== 'Theory' || existing.status !== 'Scheduled' || existing.submitted_at) {
      return res.status(409).json({ error: 'Cannot save progress for this booking in its current state.' });
    }
    if (!existing.theory_session_id || existing.session_status !== 'Published') {
      return res.status(409).json({ error: 'Your theory test has not been published yet.' });
    }
    if (existing.window_closes_at && existing.server_now >= existing.window_closes_at) {
      return res.status(409).json({ error: 'The test window has closed.' });
    }
    const questions = existing.questions || [];
    const normalized = questions.map((_, i) => (answers[i] === null || answers[i] === undefined ? null : Number(answers[i])));
    await db.query(
      `UPDATE driving_test_bookings SET answers = $1::jsonb, updated_at = NOW()
       WHERE driving_test_booking_id = $2 AND status = 'Scheduled' AND submitted_at IS NULL`,
      [JSON.stringify(normalized), req.params.id]
    );
    res.json({ saved: true });
  } catch (err) { next(err); }
}

/** POST /traffic/test-bookings/:id/submit-answers (citizen) body:{answers:[index,...]} — the
 *  system marks the test itself: "so that system can mark and automated the process ... system
 *  must record the result and tell if citizen pass or fail". Scoring itself, the status
 *  transition, and the Practical-auto-create all live in the shared finalizeTheoryBooking() (see
 *  above), so a manual submit and an automatic close produce identical results.
 *
 *  Batch 22's window check here is a deliberate anti-cheat measure, not just validation: a
 *  submit arriving within GRACE_MS of the deadline is trusted normally (this covers the common
 *  case — the citizen's own browser countdown hits zero and fires this same endpoint, with
 *  whatever network delay that involves). A submit arriving LATER than that is NOT trusted —
 *  its answers are discarded and finalizeTheoryBooking() instead scores off whatever was already
 *  saved via save-progress before the window closed, same as a true timeout. Otherwise a citizen
 *  could just leave the exam open indefinitely and submit whenever they finally finished,
 *  answering at leisure well past everyone else's deadline. */
async function submitTheoryAnswers(req, res, next) {
  try {
    const { answers } = req.body;
    if (!Array.isArray(answers) || answers.length === 0) return res.status(400).json({ error: 'answers must be a non-empty list.' });
    const { rows: bRows } = await db.query(
      `SELECT b.*, s.questions, s.status AS session_status,
              CASE WHEN s.duration_minutes IS NOT NULL AND s.test_time IS NOT NULL
                   THEN (((s.test_date + s.test_time) AT TIME ZONE 'Africa/Maseru') + (s.duration_minutes || ' minutes')::interval)
                   ELSE NULL END AS window_closes_at,
              NOW() AS server_now
       FROM driving_test_bookings b
       LEFT JOIN theory_test_sessions s ON s.theory_test_session_id = b.theory_session_id
       WHERE b.driving_test_booking_id = $1`,
      [req.params.id]
    );
    if (bRows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    const existing = bRows[0];
    if (existing.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'Not your booking.' });
    if (existing.test_type !== 'Theory' || existing.status !== 'Scheduled') {
      return res.status(409).json({ error: 'Cannot submit answers for this booking in its current state.' });
    }
    if (!existing.theory_session_id || existing.session_status !== 'Published') {
      return res.status(409).json({ error: 'Your theory test has not been published yet.' });
    }
    if (existing.submitted_at) return res.status(409).json({ error: 'You have already submitted this test.' });
    const questions = existing.questions || [];
    if (answers.length !== questions.length) {
      return res.status(400).json({ error: `answers must have exactly ${questions.length} entries.` });
    }

    const GRACE_MS = 15000;
    const pastDeadline = Boolean(
      existing.window_closes_at
      && (new Date(existing.server_now).getTime() - new Date(existing.window_closes_at).getTime()) > GRACE_MS
    );

    if (!pastDeadline) {
      await db.query(
        `UPDATE driving_test_bookings SET answers = $1::jsonb, updated_at = NOW()
         WHERE driving_test_booking_id = $2 AND status = 'Scheduled' AND submitted_at IS NULL`,
        [JSON.stringify(answers.map((a) => (a === null || a === undefined ? null : Number(a)))), req.params.id]
      );
    }

    const outcome = await finalizeTheoryBooking(req.params.id, { timedOut: pastDeadline });
    if (outcome.notFound) return res.status(404).json({ error: 'Booking not found.' });
    if (outcome.alreadyFinalized) {
      return res.status(409).json({ error: 'You have already submitted this test.' });
    }
    res.json({
      booking: outcome.booking, score: outcome.score, passed: outcome.passed,
      autoScheduledPractical: outcome.autoScheduledPractical, timedOut: pastDeadline,
    });
  } catch (err) { next(err); }
}

/** POST /traffic/test-bookings/schedule-practical (officer) body:{confirmedDate, scheduledTime,
 *  testLocation} — "on the practical schedule lets avoid individual schedule officer must
 *  schedule for once and that apply to all citizens passed test." Deliberately NOT scoped to one
 *  booking id: it sweeps up EVERY 'Requested' Practical booking at the officer's own office in
 *  one shot and gives all of them the exact same date, start time, and venue — the only way an
 *  officer can schedule a Practical test at all, so there is no path left that lets one citizen
 *  be singled out with a different (or no) date than everyone else, same reasoning that already
 *  shaped the Theory session's cancel/postpone actions. Returns how many bookings were affected;
 *  0 just means nobody was waiting to be scheduled right now, not an error. */
async function schedulePracticalBulk(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    if (!req.user.officeId) return res.status(400).json({ error: 'Your account has no office assigned.' });
    const { confirmedDate, scheduledTime, testLocation } = req.body;
    if (!confirmedDate) return res.status(400).json({ error: 'confirmedDate is required.' });
    const todayStr = new Date().toISOString().slice(0, 10);
    if (confirmedDate < todayStr) return res.status(400).json({ error: 'confirmedDate must be today or a future date.' });
    if (!scheduledTime) return res.status(400).json({ error: 'scheduledTime is required.' });
    if (!testLocation || !String(testLocation).trim()) return res.status(400).json({ error: 'testLocation is required.' });

    const { rows } = await db.query(
      `UPDATE driving_test_bookings
       SET status = 'Scheduled', confirmed_date = $1, scheduled_time = $2, test_location = $3, updated_at = NOW()
       WHERE test_type = 'Practical' AND status = 'Requested' AND office_id = $4
       RETURNING *`,
      [confirmedDate, scheduledTime, String(testLocation).trim(), req.user.officeId]
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: 'There are no practical tests waiting to be scheduled at your office right now.' });
    }

    for (const bk of rows) {
      await syncApplicationStatus(db, { sourceTable: 'driving_test_bookings', sourceId: bk.driving_test_booking_id, status: 'Scheduled' });
      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [bk.citizen_id])).rows[0];
      if (userRow) {
        await createNotification({
          userId: userRow.user_id, title: 'Practical driving test scheduled', type: 'Status Change',
          message: `Reference ${bk.booking_reference}: ${String(bk.confirmed_date).slice(0, 10)} at ${String(bk.scheduled_time).slice(0, 5)}, ${bk.test_location}.`,
        });
      }
    }
    res.json({ bookingsScheduled: rows.length, confirmedDate, scheduledTime, testLocation: String(testLocation).trim() });
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
      // The officer listing below is global (no office filter — every officer sees every
      // booking, matching how it already worked before this batch), so the sweep ahead of it is
      // unscoped too: it needs to catch an overdue sitting at ANY office, not just the calling
      // officer's own.
      await sweepExpiredTheorySittings({});
      const { rows } = await db.query(
        `SELECT b.*, c.first_name, c.last_name, s.test_time AS theory_test_time, s.duration_minutes AS theory_duration_minutes
         FROM driving_test_bookings b
         JOIN citizens c ON c.citizen_id = b.citizen_id
         LEFT JOIN theory_test_sessions s ON s.theory_test_session_id = b.theory_session_id
         ORDER BY b.requested_at DESC`
      );
      return res.json({ bookings: rows });
    }
    if (!req.user.citizenId) return res.json({ bookings: [] });
    await sweepExpiredTheorySittings({ citizenId: req.user.citizenId });
    const { rows } = await db.query(
      `SELECT b.*, s.test_time AS theory_test_time, s.duration_minutes AS theory_duration_minutes
       FROM driving_test_bookings b
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
 *  step (schedulePracticalBulk), so this check is now just defense-in-depth. A Practical Pass
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

// Batch 30 — "car fitness need physical attendance so that officer can check they citizen can not
// obtain fitness certificate without taking car to traffic". Confirmed against Lesotho's own
// published roadworthy-certificate procedure (wikiprocedure.com's Lesotho Vehicle Roadworthy
// Certificate page): the vehicle itself must be taken to the test centre, form T.C. 12 filled
// there — this was never modelled before; the flow only ever reviewed documents. This controller
// is dedicated to exactly one service type, so — unlike traffic.controller.js's shared factory,
// where 'process' is also used by several OTHER service types and had to be left alone —
// 'process' itself can simply be repointed to start from the new 'Physically Inspected' status:
// there's no other service type sharing this statusFlow that it could collide with.
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
    if (!req.body.officeId) return { error: 'officeId is required — choose an inspection centre (the same office the vehicle must be physically brought to).' };
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
    'confirm-physical-inspection': {
      from: 'Documents Checked', to: 'Physically Inspected',
      extra: (record, req) => {
        const notes = (req.body.officerResponse || '').trim();
        if (!notes) return { error: 'Inspection notes are required — confirm the vehicle was physically brought in for testing (form T.C. 12) and record the result.' };
        return {
          setSql: `physical_inspection_confirmed_at = NOW(), physical_inspection_confirmed_by_user_id = $3, physical_inspection_notes = $4`,
          params: [req.user.userId, notes],
        };
      },
    },
    'process': { from: 'Physically Inspected', to: 'Processing' },
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
  requestTestBooking, listTestBookings, getTestBooking, schedulePracticalBulk, postponeTestBooking,
  recordTestResult, cancelTestBooking, rejectTestBooking,
  upsertTheorySession, listTheorySessions, publishTheorySession, postponeTheorySession, cancelTheorySession, getTheoryTest, saveTheoryProgress, submitTheoryAnswers,
  vehicleInspectionsController,
  transportPermitsController,
  createDrivingInstructor, listDrivingInstructors, getDrivingInstructor, updateDrivingInstructorStatus,
};
