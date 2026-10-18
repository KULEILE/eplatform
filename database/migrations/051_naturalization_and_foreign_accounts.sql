-- 051_naturalization_and_foreign_accounts.sql
--
-- CITIZENSHIP BY NATURALIZATION — a self-contained Home Affairs service for a foreign national
-- who has lived in Lesotho long enough to qualify to become a citizen, plus the account-level
-- change that makes this reachable at all.
--
-- Why a new registration mode was needed: every service in this system requires
-- req.user.citizenId to be set (see backend/src/middleware/auth.js), and the only account type
-- with citizen_id = NULL today is "provisional" (is_provisional = TRUE) — reserved for someone
-- who IS presumed to already be a Mosotho citizen but hasn't yet been matched/verified against
-- the civil register (see identity_verification_requests, migration 008). A foreign national is
-- a different case entirely: they are not claiming an existing Home Affairs identity at all, so
-- a third registration mode ('foreign') and a new users.is_foreign_national flag are added so
-- their account can exist, but — by simply never getting a citizen_id — stays locked out of
-- every other department's services until this service approves their naturalization and
-- creates one. is_foreign_national is never cleared after approval: it stays as a permanent
-- historical record of how this citizen came to be one, while citizenId presence (not this
-- flag) is what every access check actually keys off from that point on.
--
-- Residency period: the applicant must show at least ELIGIBLE_RESIDENCY_YEARS (see
-- backend/src/controllers/naturalization.controller.js) years of residence, per this project's
-- brief. Note for anyone maintaining this: Lesotho's 1991 Citizenship (Amendment) Order No. 12
-- is widely cited as having raised the ordinary naturalisation residency requirement from 5 to
-- 10 years, and some secondary sources repeating "5 years" may simply be stale. This prototype
-- deliberately keeps the 5-year figure given in the brief — the constant named above is the one
-- place to change it if that's ever revisited.
--
-- Chief's Letter: a letter from the applicant's area/village chief confirming how long they have
-- actually lived there is a real, commonly-required piece of supporting evidence in Lesotho's
-- administrative processes, and is required here (chief_letter_reference) as documentary proof
-- behind the arrival date the applicant states — on top of, not instead of, that date.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_foreign_national BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS naturalization_requests (
    naturalization_request_id  SERIAL PRIMARY KEY,
    applicant_user_id             INTEGER NOT NULL REFERENCES users(user_id),
    first_name                      VARCHAR(80) NOT NULL,
    middle_name                       VARCHAR(80),
    last_name                           VARCHAR(80) NOT NULL,
    date_of_birth                         DATE NOT NULL,
    place_of_birth                          VARCHAR(120),
    sex                                       VARCHAR(20) NOT NULL CHECK (sex IN ('Male', 'Female', 'Other', 'Unspecified')),
    nationality                                VARCHAR(80) NOT NULL, -- country of origin/current nationality, not Lesotho
    travel_document_type                         VARCHAR(30) NOT NULL CHECK (travel_document_type IN ('Passport', 'Refugee Travel Document', 'Other')),
    travel_document_number                         VARCHAR(40) NOT NULL,
    immigration_status                               VARCHAR(40) NOT NULL
        CHECK (immigration_status IN ('Refugee', 'Asylum Seeker', 'Work Permit Holder', 'Study Permit Holder', 'Permanent Resident', 'Other')),
    arrival_date                                       DATE NOT NULL, -- date the applicant says they first came to live in Lesotho
    photo_reference                                      VARCHAR(255) NOT NULL,
    chief_letter_reference                                 VARCHAR(255) NOT NULL, -- chief's letter proving the residency period claimed above
    payment_reference                                        VARCHAR(80),
    receipt_image_reference                                    VARCHAR(255),
    request_reference                                           VARCHAR(30) NOT NULL UNIQUE,
    certificate_number                                             VARCHAR(30) UNIQUE, -- assigned on approval, e.g. 'CTZ-2026-483920'
    resulting_citizen_id                                             INTEGER REFERENCES citizens(citizen_id), -- set on approval
    status                                                             VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required', 'Approved', 'Rejected')),
    rejection_reason                                                     TEXT,
    reviewed_by_user_id                                                    INTEGER REFERENCES users(user_id),
    reviewed_at                                                              TIMESTAMPTZ,
    requested_at                                                               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                                                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_naturalization_applicant ON naturalization_requests(applicant_user_id);
