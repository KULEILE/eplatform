-- Supports two things discussed and agreed with the citizen (Batch 4):
--
-- 1. A parent can genuinely be Unknown, Absent, Inactive (a real citizen with no reachable
--    portal account) or Deceased, instead of being forced into the fully-verified "Present"
--    shape every time. See processBirthCertificateApplication in homeAffairs.controller.js.
--
-- 2. The ID-match fraud check (a logged-in parent registering a child must themselves be one of
--    the two named parents) needs somewhere to record who the OTHER named parent is, and whether
--    they have confirmed, disputed, or not yet been asked. This is deliberately NON-BLOCKING for
--    a birth certificate — it is issued instantly either way — it is a second truth layer that
--    settles afterwards. A dispute is the ONLY point anywhere in this domain where a Home Affairs
--    officer gets involved at all; see homeAffairsServices2.controller.js (reissue is now fully
--    automatic too) and the new parentage-disputes endpoints in homeAffairs.controller.js.

ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_declared_status VARCHAR(20)
    CHECK (father_declared_status IN ('Unknown', 'Absent', 'Inactive', 'Deceased'));
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_declared_status VARCHAR(20)
    CHECK (mother_declared_status IN ('Unknown', 'Absent', 'Inactive', 'Deceased'));

-- Whichever of father_citizen_id/mother_citizen_id is NOT the submitting parent
-- (parent_citizen_id) — the parent with a stake in confirming this registration really happened.
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS other_parent_citizen_id INTEGER REFERENCES citizens(citizen_id);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS other_parent_confirmation_status VARCHAR(20) NOT NULL DEFAULT 'Not Applicable'
    CHECK (other_parent_confirmation_status IN ('Not Applicable', 'Pending', 'Confirmed', 'Disputed', 'Dispute Upheld', 'Dispute Dismissed'));
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS other_parent_confirmed_at TIMESTAMPTZ;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS other_parent_signature_reference TEXT;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS other_parent_dispute_reason TEXT;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS other_parent_dispute_resolved_by_user_id INTEGER REFERENCES users(user_id);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS other_parent_dispute_resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_birth_records_other_parent ON birth_records(other_parent_citizen_id);
CREATE INDEX IF NOT EXISTS idx_birth_records_other_parent_status ON birth_records(other_parent_confirmation_status);

-- The old officer-reviewed reissue pipeline (Submitted -> Under Review -> Approved/Rejected) is
-- retired as of this batch — a reissue request is now auto-approved on submission, same spirit
-- as birth-certificate issuance itself. Nothing here needs a schema change for that (the table
-- already allows 'Approved' as a status); this comment just documents why no new reissue rows
-- will ever again be seen sitting in 'Submitted' or 'Under Review' going forward.
