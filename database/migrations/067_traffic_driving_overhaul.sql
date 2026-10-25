-- 067_traffic_driving_overhaul.sql
--
-- Rebuilds the driving-credential path in Traffic around the real-world sequence the citizen
-- actually has to follow: write the Theory test, pass it, write the Practical test (at least
-- three days later), pass it, and ONLY THEN does the system produce a Learner's Permit — rather
-- than letting a citizen apply for a Learner's Permit directly with no exam, and separately
-- requiring one already held just to BOOK the theory test, which is what migrations 042/043 had
-- in place before. The Driving Licence Application/Renewal/Replacement services are also moved
-- off the generic department factory onto their own bespoke controller (driving_licence) so they
-- can carry the same "reuse your National ID photo/fingerprints", "renewal blocked unless
-- expired or damaged with proof", "3-month lost/stolen wait" and "single-confirm surrender of the
-- Learner's Permit at collection" patterns already proven out for Passport (migrations
-- 064-066) — they keep living in traffic_records, just driven by different application code.

ALTER TABLE driving_test_bookings
    -- Officer-entered numeric score, requested for both Theory and Practical sittings alongside
    -- the existing Pass/Fail result column (result stays the authoritative gate; marks is the
    -- officer's record of how well the citizen actually did).
    ADD COLUMN IF NOT EXISTS marks INTEGER
        CHECK (marks IS NULL OR (marks >= 0 AND marks <= 100)),
    -- Free-text venue for a Practical sitting, entered by the officer — there is no notion of a
    -- dedicated "driving test centre" in the offices table (every office is just a department
    -- branch), so rather than overload that table for one field, the practical test's actual
    -- venue is recorded directly on the booking.
    ADD COLUMN IF NOT EXISTS test_location VARCHAR(255),
    -- Links an auto-generated Practical booking back to the Theory booking it followed, so the
    -- "practical must be at least 3 days after theory" rule and the citizen-facing "this follows
    -- your passed theory test" display both have something concrete to point at.
    ADD COLUMN IF NOT EXISTS theory_booking_id INTEGER REFERENCES driving_test_bookings(driving_test_booking_id),
    -- The officer-authored question list for one specific Theory sitting (a JSON array of
    -- question strings) — there is no shared, reusable question bank today, and none was asked
    -- for; this is deliberately a lightweight per-sitting list, not an auto-graded exam engine.
    ADD COLUMN IF NOT EXISTS theory_questions JSONB,
    ADD COLUMN IF NOT EXISTS questions_set_by_user_id INTEGER REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS questions_set_at TIMESTAMPTZ;

ALTER TABLE traffic_records
    -- The Practical test booking whose pass auto-generated this row, when service_type =
    -- 'Learner Permit' — lets the Driving Licence application look up and display exactly which
    -- test produced the permit it is relying on.
    ADD COLUMN IF NOT EXISTS source_test_booking_id INTEGER REFERENCES driving_test_bookings(driving_test_booking_id),
    -- The Learner Permit traffic_records row a 'Driving Licence Application' (first licence) is
    -- relying on — set at apply time so it can be displayed throughout the application, and so
    -- collection can require that specific permit be physically surrendered.
    ADD COLUMN IF NOT EXISTS linked_learner_permit_id INTEGER REFERENCES traffic_records(traffic_record_id),
    -- Physical-surrender gate for a first driving licence collection, exactly the same shape as
    -- passport_records.surrender_status (migration 066): NULL when not applicable (Renewal,
    -- Replacement, or any record that isn't gated), set to 'Awaiting Surrender' at apply time for
    -- a first-time Application that is relying on a Learner Permit.
    ADD COLUMN IF NOT EXISTS surrender_status VARCHAR(20)
        CHECK (surrender_status IS NULL OR surrender_status IN ('Awaiting Surrender', 'Surrendered', 'Not Surrendered')),
    ADD COLUMN IF NOT EXISTS surrender_verified_by_user_id INTEGER REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS surrender_verified_at TIMESTAMPTZ,
    -- The "renew early because it's damaged" exception: a citizen cannot renew before their
    -- current licence expires UNLESS they declare it damaged and provide proof.
    ADD COLUMN IF NOT EXISTS renewal_damaged BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS renewal_damage_proof_reference VARCHAR(255),
    -- When replacementReason is Lost or Stolen, the date it was reported — the 3-month wait
    -- (same pattern as passport/National ID replacement) is computed from this date.
    ADD COLUMN IF NOT EXISTS reported_lost_at DATE,
    -- Which capture path a driving-licence application's photo/fingerprints came from — 'id'
    -- (reused from the citizen's own collected National ID) or 'new' (captured fresh for this
    -- application). Purely informational/audit; resolution of the actual reference values always
    -- happens server-side regardless of what the client claims.
    ADD COLUMN IF NOT EXISTS photo_source VARCHAR(10) CHECK (photo_source IS NULL OR photo_source IN ('id', 'new'));
