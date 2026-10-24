-- 064_passport_enhancements.sql
--
-- Passport service enhancement, client-requested:
--  1. A citizen must be at least 16 to apply for a passport for themselves — same minimum age as
--     a National ID card (enforced in passport.controller.js — no schema change for the age rule
--     itself).
--  2. A citizen who is 16+ must already hold a COLLECTED National ID card before they can apply
--     for a passport for themselves (enforced in applyPassport; no schema change needed — reads
--     the existing national_id_cards table).
--  3. A parent/guardian can apply for a passport on behalf of a child under 16, but ONLY for a
--     child they have a real relationship with, recorded on that child's birth record
--     (birth_records.parent_citizen_id / father_citizen_id / mother_citizen_id — the same columns
--     the birth-certificate domain already uses, see listMyBirthCertificates in
--     homeAffairsServices2.controller.js). The moment that child turns 16, the parent can no
--     longer apply on their behalf — the child must apply themselves. This needs a way to tell
--     who actually submitted an application apart from who it's FOR, hence applicant_citizen_id
--     below (citizen_id stays the passport HOLDER/subject, exactly as every existing query that
--     joins citizens on it already assumes).
--  4. The photo can be reused from the citizen's National ID photo, or a fresh one captured — the
--     citizen's choice (no schema change — photo_reference already exists; which source is used
--     is a request-time decision, not stored separately).
--  5. Renewal is blocked unless the current (collected) passport has actually expired, UNLESS the
--     citizen declares its pages are full ("finished") — a genuine alternative real-world renewal
--     reason distinct from Lost/Stolen replacement. renewal_reason records which of the two
--     applied, for the officer's reference.
--  6. A genuinely new service: passport Replacement (Lost/Stolen), mirroring how National ID
--     replacement already works (migration 063) — a supporting document is required, and a
--     mandatory 3-month wait applies from the date the citizen reports losing it. Migration 047's
--     own comment anticipated this ("a lost/stolen/damaged passport can be added the same way
--     later if needed") — this is that later.

ALTER TABLE passport_records
    ADD COLUMN IF NOT EXISTS applicant_citizen_id INTEGER REFERENCES citizens(citizen_id);

-- Backfill: every existing row was, by definition, applied for by its own holder (on-behalf-of
-- applications did not exist before this migration).
UPDATE passport_records SET applicant_citizen_id = citizen_id WHERE applicant_citizen_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_passport_applicant ON passport_records(applicant_citizen_id);

-- 'Replacement' is new; 'New' and 'Renewal' (migration 047) are kept exactly as they were.
ALTER TABLE passport_records DROP CONSTRAINT IF EXISTS passport_records_application_type_check;
ALTER TABLE passport_records ADD CONSTRAINT passport_records_application_type_check
    CHECK (application_type IN ('New', 'Renewal', 'Replacement'));

ALTER TABLE passport_records
    ADD COLUMN IF NOT EXISTS replacement_reason VARCHAR(20)
        CHECK (replacement_reason IN ('Lost', 'Stolen')),
    ADD COLUMN IF NOT EXISTS replacement_details TEXT,
    ADD COLUMN IF NOT EXISTS replacement_proof_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reported_lost_at DATE,
    ADD COLUMN IF NOT EXISTS renewal_reason VARCHAR(20)
        CHECK (renewal_reason IN ('Expired', 'Pages Full'));
