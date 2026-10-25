-- 068_theory_test_sessions.sql
--
-- Rebuilds the Theory test itself into a real multiple-choice exam that the system marks on its
-- own, per the explicit request: "this test must be multiple choice so that system can mark and
-- automated the process ... officer must set time and the test must have same questions ... every
-- citizen who chooses to write on that day must write same questions. officer publish it, test
-- all citizen who supposed to write must receive notification and open for them to take test."
--
-- Migration 067 gave every individual Theory BOOKING its own officer-authored question list
-- (driving_test_bookings.theory_questions) with a manually-entered Pass/Fail result — that was
-- wrong on two counts raised here: (1) it let different citizens sitting on the same day get
-- different questions, when they must all get the SAME questions, and (2) it required an officer
-- to grade a free-text question list by hand, when it must instead be multiple choice and
-- self-marking. Both are fixed by moving the question set from the booking to a new SESSION, one
-- per office per day, that the officer authors once, with a correct answer on every question so
-- the system can score a citizen's submitted answers itself.
--
-- driving_test_bookings.theory_questions / questions_set_by_user_id / questions_set_at (067) are
-- left in place but no longer written to by new code (additive-only migration policy) — any
-- historical data in them is harmless and simply unused going forward.

CREATE TABLE IF NOT EXISTS theory_test_sessions (
    theory_test_session_id SERIAL PRIMARY KEY,
    office_id               INTEGER NOT NULL REFERENCES offices(office_id),
    test_date                DATE NOT NULL,
    -- "officer must set time" — the sitting's start time, entered by the officer, shown to every
    -- citizen booked for that date once published.
    test_time                 TIME,
    -- The shared multiple-choice question set for this sitting: a JSON array of
    -- {"question": "...", "options": ["...", "...", ...], "correctIndex": 0} objects. Every
    -- citizen who writes this session sees the exact same questions and options, in the exact
    -- same order — "do not write questions for specific every citizen". correctIndex is never
    -- sent to a citizen (see getTheoryTest in trafficServices2.controller.js) — only used
    -- server-side to mark their submitted answers.
    questions                 JSONB,
    -- Draft while the officer is still building the question set; Published once they click
    -- "Publish", at which point it is locked (no further edits) and every currently-Scheduled
    -- Theory booking for this office/date is linked to it and notified that the test is open.
    status                     VARCHAR(20) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Published')),
    created_by_user_id          INTEGER REFERENCES users(user_id),
    published_by_user_id         INTEGER REFERENCES users(user_id),
    published_at                  TIMESTAMPTZ,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One session per office per day — this IS the "same questions for everyone who writes that
    -- day" rule, enforced structurally rather than just by convention.
    UNIQUE (office_id, test_date)
);

ALTER TABLE driving_test_bookings
    -- Which session (shared question set + time) this Theory booking was sat under. Set once the
    -- matching session is published (either at publish time, for bookings already made, or
    -- immediately at booking time, for a booking made after the session was already published).
    ADD COLUMN IF NOT EXISTS theory_session_id INTEGER REFERENCES theory_test_sessions(theory_test_session_id),
    -- The citizen's submitted multiple-choice answers: a JSON array of option indexes, same
    -- length and order as the session's questions.
    ADD COLUMN IF NOT EXISTS answers JSONB,
    -- When the citizen submitted their answers — also doubles as "already sat the test, cannot
    -- submit again".
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_theory_sessions_office_date ON theory_test_sessions(office_id, test_date);
CREATE INDEX IF NOT EXISTS idx_driving_test_bookings_session ON driving_test_bookings(theory_session_id);
