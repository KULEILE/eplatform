-- Follow-up fixes the citizen found by testing Batch 4 (parentage verification):
--
-- 1. A self-application (migration 059) has no "submitting parent" at all — the applicant IS the
--    child, not either parent — so the old single other_parent_* column (built for the "one
--    submitter + one other parent" case) could never represent "both named parents still need to
--    confirm". This migration replaces it with a confirmation/dispute slot PER PARENT
--    (father_confirmation_* and mother_confirmation_*), so either or both parents can be pending,
--    confirmed, or disputed independently, whether the registration came from a logged-in parent
--    or a public self-application.
--
-- 2. Previously, upholding a dispute just changed a status column and notified people — nothing
--    about the birth record or the already-issued certificate ever changed, so the false
--    parentage link stayed in the data forever. Upholding a dispute now clears that parent's
--    fields on the birth record and flags the linked birth certificate 'Flagged for Correction'
--    (an existing status already used by Pensions/Finance for the same purpose — see migrations
--    011 and 048), so it's visibly no longer fully trusted until a Home Affairs officer corrects
--    it. See resolveParentageDispute in homeAffairs.controller.js.

ALTER TABLE birth_records DROP COLUMN IF EXISTS other_parent_citizen_id;
ALTER TABLE birth_records DROP COLUMN IF EXISTS other_parent_confirmation_status;
ALTER TABLE birth_records DROP COLUMN IF EXISTS other_parent_confirmed_at;
ALTER TABLE birth_records DROP COLUMN IF EXISTS other_parent_signature_reference;
ALTER TABLE birth_records DROP COLUMN IF EXISTS other_parent_dispute_reason;
ALTER TABLE birth_records DROP COLUMN IF EXISTS other_parent_dispute_resolved_by_user_id;
ALTER TABLE birth_records DROP COLUMN IF EXISTS other_parent_dispute_resolved_at;

ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_confirmation_status VARCHAR(20) NOT NULL DEFAULT 'Not Applicable'
    CHECK (father_confirmation_status IN ('Not Applicable', 'Pending', 'Confirmed', 'Disputed', 'Dispute Upheld', 'Dispute Dismissed'));
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_confirmed_at TIMESTAMPTZ;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_confirmation_signature_reference TEXT;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_dispute_reason TEXT;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_dispute_resolved_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_dispute_resolved_at TIMESTAMPTZ;

ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_confirmation_status VARCHAR(20) NOT NULL DEFAULT 'Not Applicable'
    CHECK (mother_confirmation_status IN ('Not Applicable', 'Pending', 'Confirmed', 'Disputed', 'Dispute Upheld', 'Dispute Dismissed'));
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_confirmed_at TIMESTAMPTZ;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_confirmation_signature_reference TEXT;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_dispute_reason TEXT;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_dispute_resolved_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_dispute_resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_birth_records_father_confirmation ON birth_records(father_confirmation_status);
CREATE INDEX IF NOT EXISTS idx_birth_records_mother_confirmation ON birth_records(mother_confirmation_status);

-- 'Flagged for Correction' already exists as a status word elsewhere (pension_records,
-- government_employment_records) — reused here for the same meaning: issued, but currently known
-- to be wrong in a way that needs an officer's attention before it can be fully trusted again.
ALTER TABLE birth_certificates DROP CONSTRAINT IF EXISTS birth_certificates_status_check;
ALTER TABLE birth_certificates ADD CONSTRAINT birth_certificates_status_check
    CHECK (status IN ('Certificate Generated', 'Ready for Collection', 'Collected', 'Flagged for Correction'));

-- 3. No safeguard previously existed against an impossible parent/child age gap (e.g. registering
-- a "child" older than the parent, or only a few years younger). See the new
-- MIN_PARENT_AGE_GAP_YEARS check in processBirthCertificateApplication — purely an application
-- validation, so it needs no schema change here; this comment just documents why it now appears
-- alongside this migration.
