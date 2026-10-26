-- Batch 22 — "this theory test must have duration and it must close automatically when the
-- time is up."
--
-- Confirmed with the user: ONE shared exam window per sitting, not a personal per-citizen timer
-- — the officer already sets a single start TIME for everyone booked that day/office (migration
-- 068), so duration_minutes extends that into a window: [test_date + test_time,
-- test_date + test_time + duration_minutes). Nobody can open the test before the window starts;
-- the window closes automatically for everyone at the same moment, whether or not they
-- submitted — see sweepExpiredTheorySittings() / finalizeTheoryBooking() in
-- trafficServices2.controller.js, which auto-scores whatever answers were saved (via the new
-- save-progress endpoint) the instant the window is noticed to have closed, same as a manual
-- submission would.
--
-- No new column is needed on driving_test_bookings for this — the existing `answers` JSONB
-- column (migration 068) already holds a citizen's in-progress answers; this batch just starts
-- writing to it continuously while they're taking the test, not only at final submission, so an
-- auto-close always has something accurate to score even if the citizen's browser tab closed,
-- crashed, or lost connection before they clicked Submit.
ALTER TABLE theory_test_sessions
    ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
        CHECK (duration_minutes IS NULL OR (duration_minutes > 0 AND duration_minutes <= 240));
