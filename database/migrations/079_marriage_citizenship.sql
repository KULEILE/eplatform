-- 079_marriage_citizenship.sql
--
-- CITIZENSHIP BY REGISTRATION (MARRIAGE TO A LESOTHO CITIZEN) — Home Affairs, a second and
-- legally distinct route into citizenship alongside Citizenship by Naturalization (migration
-- 051). Based on section 40 of the Constitution of Lesotho, 1993, as substituted by the Eighth
-- Amendment to the Constitution Act, 2018 ("the Eighth Amendment"):
--
--   40.(1) A person who marries a citizen of Lesotho shall, upon making application and taking
--   oath of allegiance, be registered as a Lesotho citizen after five years of (a) cohabitation
--   in Lesotho, and (b) continuous and lawful stay in Lesotho with a citizen of Lesotho.
--   (2) A person who marries a citizen of Lesotho who, but for his death, would have continued
--   to be a citizen of Lesotho is entitled to be registered after five years of continuous and
--   lawful stay in Lesotho — no cohabitation requirement, since the spouse is deceased.
--
-- This is deliberately its own table/controller, not a field added to naturalization_requests —
-- same reasoning naturalization.controller.js's own header comment gives for not reusing
-- utils/workflow.js: this service has an entirely different evidence bundle (a marriage record
-- reference and cohabitation dates, not a travel document and a chief's letter) and a different
-- eligibility test (cohabitation + continuous stay with a spouse, not simple residency).
--
-- PROVING THE MARRIAGE: Home Affairs already has a marriage_records table (migration 031). The
-- applicant here is the "spouse2" on some existing, Approved marriage record — someone who may
-- never have had an account in this system at all (spouse2 is recorded as supplied free-text
-- name/DOB/nationality, exactly like a birth registration's parents — see migration 031's own
-- header comment). So the applicant supplies the marriage certificate number issued on that
-- record; the system looks it up and performs a soft name match against spouse2_name as a sanity
-- check, but the real verification is the officer's own side-by-side review (see
-- marriageCitizenship.controller.js) — consistent with how a chief's letter reference or a
-- government-employment PIN lookup elsewhere in this prototype is likewise officer-verified
-- evidence, not independently cross-checked against a separate system of record.
--
-- DIVORCE CHECK: divorce_records (migration 032) records marriage_reference as free text — this
-- system's own certificate number, or an external one. An application referencing a marriage
-- that has since been dissolved (an Approved divorce_records row citing the same certificate
-- number) is rejected outright — see marriageCitizenship.controller.js.
--
-- WIDOW/WIDOWER CASE: citizens.is_deceased/date_of_death already exist (migration 020, officer-
-- set only, from death registration) — enough to detect when the marriage's citizen spouse has
-- died and apply the lighter, no-cohabitation eligibility test from section 40(2) instead.
--
-- RESULTING STATUS: 'Registered', a new citizenship_status value distinct from 'Naturalised'.
-- The law itself treats registration and naturalization as separate routes (section 41(2) of the
-- amended Constitution applies its 10-year social-benefits restriction to "naturalised or
-- registered" citizens alike, as two distinct categories) — kept distinguishable here so that
-- restriction (not built in this batch) has accurate data to key off later if it's ever added.
--
-- NOT IN THIS BATCH: the section 41 dual-citizenship permission and the section 41A restoration-
-- of-citizenship provisions from the Eighth Amendment are informational, not something this
-- citizen-facing prototype currently needs to model or restrict — nothing here prevents either.
-- The 10-year social-benefits restriction (section 41(2)(a)) is a real, separate gap against
-- pensions.controller.js's beforeApply, intentionally left for a future batch.

-- Pre-existing bug fix, found while testing this batch: naturalization_requests.status
-- (migration 051) is VARCHAR(30), but 'Additional Information Required' is 31 characters —
-- one over the limit. requestInformationNaturalization has therefore always failed with a
-- Postgres "value too long for type character varying(30)" error in the live system. Widening
-- it here (a VARCHAR widen never loses data) rather than editing 051 directly, since that
-- migration has already been applied. The new marriage_citizenship_requests table below uses
-- VARCHAR(40) for the same column from the start, to avoid repeating this.
ALTER TABLE naturalization_requests ALTER COLUMN status TYPE VARCHAR(40);

ALTER TABLE citizens DROP CONSTRAINT IF EXISTS citizens_citizenship_status_check;
DO $$
DECLARE
    existing_constraint text;
BEGIN
    SELECT con.conname INTO existing_constraint
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'citizens' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%citizenship_status%';
    IF existing_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE citizens DROP CONSTRAINT %I', existing_constraint);
    END IF;
END $$;
ALTER TABLE citizens ADD CONSTRAINT citizens_citizenship_status_check
    CHECK (citizenship_status IN ('Citizen', 'Naturalised', 'Permanent Resident', 'Pending', 'Registered'));

CREATE TABLE IF NOT EXISTS marriage_citizenship_requests (
    marriage_citizenship_request_id  SERIAL PRIMARY KEY,
    applicant_user_id                   INTEGER NOT NULL REFERENCES users(user_id),
    marriage_record_id                     INTEGER NOT NULL REFERENCES marriage_records(marriage_record_id),

    first_name                                VARCHAR(80) NOT NULL,
    middle_name                                  VARCHAR(80),
    last_name                                       VARCHAR(80) NOT NULL,
    date_of_birth                                      DATE NOT NULL,
    place_of_birth                                        VARCHAR(120),
    sex                                                      VARCHAR(20) NOT NULL CHECK (sex IN ('Male', 'Female', 'Other', 'Unspecified')),
    nationality                                                VARCHAR(80) NOT NULL, -- applicant's own country of origin/current nationality

    travel_document_type                                          VARCHAR(30) NOT NULL CHECK (travel_document_type IN ('Passport', 'Refugee Travel Document', 'Other')),
    travel_document_number                                           VARCHAR(40) NOT NULL,

    arrival_date                                                        DATE NOT NULL, -- start of "continuous and lawful stay in Lesotho" — s.40(1)(b)/(2)
    -- Cohabitation start date — s.40(1)(a). Required for the living-spouse pathway, left NULL for
    -- the widow/widower pathway (s.40(2) carries no cohabitation requirement at all).
    cohabitation_start_date                                               DATE,

    photo_reference                                                          VARCHAR(255) NOT NULL,
    payment_reference                                                           VARCHAR(80),
    receipt_image_reference                                                       VARCHAR(255),
    request_reference                                                                VARCHAR(30) NOT NULL UNIQUE,
    certificate_number                                                                  VARCHAR(30) UNIQUE, -- assigned on approval, e.g. 'REG-2026-483920'
    resulting_citizen_id                                                                   INTEGER REFERENCES citizens(citizen_id), -- set on approval

    -- Hand-biometric capture, same reasoning as naturalization_requests: this applicant has no
    -- citizen_id yet, so templates are held here and enrolled to citizen_biometrics on approval.
    left_hand_biometric_reference                                                             VARCHAR(255),
    right_hand_biometric_reference                                                               VARCHAR(255),
    left_hand_template                                                                              JSONB,
    right_hand_template                                                                                JSONB,

    status                                                                                               VARCHAR(40) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required', 'Approved', 'Rejected')),
    rejection_reason                                                                                        TEXT,
    reviewed_by_user_id                                                                                        INTEGER REFERENCES users(user_id),
    reviewed_at                                                                                                   TIMESTAMPTZ,
    requested_at                                                                                                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                                                                                          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marriage_citizenship_applicant ON marriage_citizenship_requests(applicant_user_id);
CREATE INDEX IF NOT EXISTS idx_marriage_citizenship_marriage_record ON marriage_citizenship_requests(marriage_record_id);
