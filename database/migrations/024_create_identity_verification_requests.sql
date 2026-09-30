-- 024_create_identity_verification_requests.sql
--
-- Closes a real gap: a provisional account (self-registered with no matching Home Affairs
-- record) had NO path to ever become verified — every service that grants a citizen_id
-- (birth registration, national ID) requires a citizen_id to already exist to even apply.
-- This table is the missing front door: the citizen states what they know about their own
-- identity (an existing permanent identity number, or none if they were never registered),
-- a Home Affairs officer reviews it against the citizens register, and either links the
-- account to the matching record or enrols them as a new identity — exactly the manual
-- enrolment path the citizens table's own comment already anticipated.

CREATE TABLE IF NOT EXISTS identity_verification_requests (
    request_id                         SERIAL PRIMARY KEY,
    user_id                            INTEGER NOT NULL REFERENCES users(user_id),
    reference_number                   VARCHAR(30) NOT NULL UNIQUE,
    has_existing_id                    BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_permanent_identity_number  VARCHAR(20),
    first_name                         VARCHAR(80) NOT NULL,
    middle_name                        VARCHAR(80),
    last_name                          VARCHAR(80) NOT NULL,
    date_of_birth                      DATE NOT NULL,
    place_of_birth                     VARCHAR(120),
    sex                                VARCHAR(20) NOT NULL CHECK (sex IN ('Male', 'Female', 'Other', 'Unspecified')),
    status                             VARCHAR(20) NOT NULL DEFAULT 'Pending'
                                            CHECK (status IN ('Pending', 'Verified', 'Rejected')),
    matched_citizen_id                 INTEGER REFERENCES citizens(citizen_id),
    handling_officer_id                INTEGER REFERENCES users(user_id),
    rejection_reason                   TEXT,
    submitted_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at                        TIMESTAMPTZ,
    created_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_requests_user ON identity_verification_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_identity_requests_status ON identity_verification_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_requests_reference ON identity_verification_requests(reference_number);
