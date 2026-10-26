-- Batch 23 — "let's make enable the traffic officer to be able cancel test and set the new one"
--
-- Explicitly scoped to the whole shared Theory SESSION, never to one citizen's individual
-- booking — the user was direct about why: "what we must avoid is to allow office to deal with
-- individuals because he may see the name of person he do not like and keep setting new test or
-- difficult one for specific one." Cancelling always applies uniformly to every citizen sitting
-- that day, with no way for an officer to single one person out, same reasoning that already
-- shaped Postpone (migration 069/070) and Publish (migration 068) before it.
--
-- "Cancel" is deliberately different from the existing Postpone: Postpone keeps the same locked
-- question set and just moves the date/time, carrying every linked citizen along automatically —
-- for when the sitting itself is still fine, just needs to happen at a different time (bad
-- weather, etc.). Cancel is for when the session itself needs to be scrapped and redone from
-- scratch (e.g. a problem with the question set) — see cancelTheorySession() in
-- trafficServices2.controller.js, which reverts the session back to 'Draft' (no new status value
-- needed — an unpublished session already means Draft) so the officer can freely re-author it and
-- publish again, reusing the exact same editing/publishing flow a brand-new session uses. Any
-- citizen still waiting (Scheduled, not yet submitted) is unlinked back to "awaiting officer to
-- publish" — exactly how they looked before any session existed for that date — and notified;
-- anyone who already took and was graded under the old session keeps that result untouched, since
-- cancelling a session afterward for an unrelated reason shouldn't retroactively void an already-
-- recorded outcome.
ALTER TABLE theory_test_sessions
    ADD COLUMN IF NOT EXISTS cancelled_reason TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by_user_id INTEGER REFERENCES users(user_id);
