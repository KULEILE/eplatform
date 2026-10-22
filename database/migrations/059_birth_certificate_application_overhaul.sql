-- 059_birth_certificate_application_overhaul.sql
--
-- Birth registration becomes fully automatic: both parents' permanent identity numbers are
-- checked against the citizens register the moment an application is submitted, and the
-- application is approved (certificate generated immediately) or rejected (with a clear reason)
-- in that same step — there is no officer review queue for a NEW application any more. The old
-- manual review columns/workflow (registration_status values 'Under Review', 'Verification in
-- Progress', etc., and handling_officer_id) are untouched and still work for any application
-- that was already sitting in one of those states before this migration — this only changes how
-- a NEW application behaves from here on.
--
-- This also supports a brand new entry point: an adult with no matching citizen record at all
-- can apply for their OWN birth certificate (self-registration) without being logged in, from
-- the account-creation page. For that case there is no logged-in parent submitting on the
-- child's behalf, so parent_citizen_id — previously required — must become optional.
--
-- A parent is either a Lesotho citizen (their permanent identity number is typed and checked
-- against the citizens table) or a non-citizen (a passport number + photo of the passport is
-- recorded instead, since there is no register of foreign passports to check it against). At
-- least one parent must be a citizen whose number matches our records — see the application
-- code for why: this is a safeguard against an unverifiable application being auto-approved
-- from nothing, not an official Home Affairs rule.

ALTER TABLE birth_records ALTER COLUMN parent_citizen_id DROP NOT NULL;

-- TRUE = a parent/guardian with an existing account submitted this (the normal case so far).
-- FALSE = the applicant is applying for their own birth certificate, with no account yet.
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS is_self_application BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_is_citizen BOOLEAN;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_identity_number VARCHAR(20);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_citizen_id INTEGER REFERENCES citizens(citizen_id);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_passport_number VARCHAR(30);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_passport_image_reference TEXT;

ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_is_citizen BOOLEAN;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_identity_number VARCHAR(20);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_citizen_id INTEGER REFERENCES citizens(citizen_id);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_passport_number VARCHAR(30);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_passport_image_reference TEXT;

-- Supporting documents, stored the same way every other upload in this system is (file_blobs,
-- see migration 050) — the column holds the file_key reference string, not the image itself.
-- Chief's letter and proof of birth are the two Home Affairs always needs; marriage certificate
-- and acknowledgement of paternity are only needed "where applicable" (see the application code
-- and form), so they stay nullable even for a brand new application.
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS chief_letter_image_reference TEXT;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS proof_of_birth_image_reference TEXT;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS marriage_certificate_image_reference TEXT;
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS acknowledgement_of_paternity_image_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_birth_records_father_citizen ON birth_records(father_citizen_id);
CREATE INDEX IF NOT EXISTS idx_birth_records_mother_citizen ON birth_records(mother_citizen_id);
