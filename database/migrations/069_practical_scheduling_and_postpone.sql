-- Batch 20 — three changes to the Theory -> Practical driving test flow, all from the same
-- message: "we learner permit and driving theory test which make the same work that is
-- repetition. also lets reduce the day system set for practical test after theory it should be
-- following day after theory test. and the system before it schedule it should aske officer the
-- location where practical will take place and the time they will start. Also the system must
-- allow officer to postpone test because someday weather may be bad or move"
--
--   (a) The "Learner Permit" hub tile/page is removed as a separate service (see the frontend
--       changes in this batch) — its read-only status content now lives inside this same
--       Driving Theory / Practical Test page instead. No schema change needed for that part.
--
--   (b) The auto-created Practical booking's suggested date moves from three days after the
--       Theory sitting to the very next day — a code-only change in submitTheoryAnswers()
--       (trafficServices2.controller.js), no schema change needed for that part either.
--
--   (c) That auto-created Practical booking no longer jumps straight to 'Scheduled' with no
--       venue or start time. It is now inserted as 'Requested' (status already allows this —
--       see migration 043) with only a suggested date; an officer must supply BOTH a location
--       AND a start time (schedulePracticalTest()) before it becomes 'Scheduled'. Theory's start
--       time already lives on theory_test_sessions.test_time, but Practical bookings have never
--       had a time field at all — hence scheduled_time below.
--
--   (d) A new officer "postpone" action — for a bad-weather day or any other reason — on an
--       already-scheduled Practical booking (postponeTestBooking()) and, separately, on an
--       already-published Theory session (postponeTheorySession(), which also carries every
--       citizen already linked to it to the new date without touching the locked question set).
--       Both record who postponed it, when, and why, for a simple audit trail — the same shape
--       as rejection_reason elsewhere in this app.

ALTER TABLE driving_test_bookings
    ADD COLUMN IF NOT EXISTS scheduled_time TIME,              -- officer-set start time for a Practical sitting
    ADD COLUMN IF NOT EXISTS postponed_reason TEXT,
    ADD COLUMN IF NOT EXISTS postponed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS postponed_by_user_id INTEGER REFERENCES users(user_id);

ALTER TABLE theory_test_sessions
    ADD COLUMN IF NOT EXISTS postponed_reason TEXT,
    ADD COLUMN IF NOT EXISTS postponed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS postponed_by_user_id INTEGER REFERENCES users(user_id);
