-- Batch 14: a citizen can claim their not-yet-expired passport's pages are full to renew it
-- (migration 065 added the last-page photo proof for that claim) — but a photo alone can't prove
-- the physical booklet still exists. Someone whose passport is actually lost or stolen could
-- falsely claim "pages full" to dodge the stricter Replacement process (proof + a 3-month wait).
-- This adds a physical-surrender checkpoint: the citizen must bring the original passport to the
-- office, and an officer must verify it in hand, before a Pages Full renewal can be confirmed and
-- produced. It also records the passport number the citizen typed in as part of applying, as a
-- lightweight corroboration check against the number already on file for their current passport.

ALTER TABLE passport_records
    ADD COLUMN IF NOT EXISTS entered_passport_number VARCHAR(20),
    ADD COLUMN IF NOT EXISTS surrender_status VARCHAR(20)
        CHECK (surrender_status IS NULL OR surrender_status IN ('Awaiting Surrender', 'Surrendered', 'Not Surrendered')),
    ADD COLUMN IF NOT EXISTS surrender_verified_by_user_id INTEGER REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS surrender_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN passport_records.surrender_status IS
    'Only meaningful for a Renewal with renewal_reason = ''Pages Full''. NULL for every other application — there is nothing to physically surrender for a New application, an Expired renewal, or a Replacement (which is precisely for when the passport cannot be produced).';
