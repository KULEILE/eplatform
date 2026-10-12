-- 038_create_reissue_and_name_change.sql
--
-- Three new, independent Home Affairs services:
--   1. Reissue of birth certificate — a citizen whose certificate was lost/damaged/never
--      collected asks for it to be produced again. Distinct from birth REGISTRATION (which
--      only ever happens once); this is a request against an already-approved birth_record.
--   2. Death certificate issuance — distinct from death REGISTRATION (reportDeath/approveDeath,
--      migration 020). Any citizen who can show a relationship to the deceased can request the
--      certificate itself, independently of who originally reported the death.
--   3. Change or alteration of name/surname — a FORMAL legal name change (deed poll / marriage /
--      religious conversion etc.), distinct from the generic "corrections" mechanism (migration
--      020) which only fixes data-entry errors. Approval here actually updates citizens.first_name
--      / citizens.last_name and issues a confirmation reference, the same way a certificate would.

CREATE TABLE IF NOT EXISTS birth_certificate_reissue_requests (
    reissue_request_id    SERIAL PRIMARY KEY,
    citizen_id               INTEGER NOT NULL REFERENCES citizens(citizen_id),
    birth_record_id            INTEGER NOT NULL REFERENCES birth_records(birth_record_id),
    reason                       VARCHAR(30) NOT NULL CHECK (reason IN ('Lost', 'Damaged', 'Never Collected', 'Other')),
    details                        TEXT,
    reissue_reference                VARCHAR(30) NOT NULL UNIQUE,
    status                             VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required', 'Approved', 'Rejected')),
    rejection_reason                     TEXT,
    reviewed_by_user_id                    INTEGER REFERENCES users(user_id),
    reviewed_at                              TIMESTAMPTZ,
    requested_at                               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bc_reissue_citizen ON birth_certificate_reissue_requests(citizen_id);
CREATE INDEX IF NOT EXISTS idx_bc_reissue_birth_record ON birth_certificate_reissue_requests(birth_record_id);

CREATE TABLE IF NOT EXISTS death_certificate_requests (
    death_certificate_request_id  SERIAL PRIMARY KEY,
    citizen_id                       INTEGER NOT NULL REFERENCES citizens(citizen_id), -- the requester, not necessarily the deceased
    death_record_id                    INTEGER NOT NULL REFERENCES death_records(death_record_id),
    relationship_to_deceased              VARCHAR(60) NOT NULL,
    reason                                  VARCHAR(30) NOT NULL CHECK (reason IN ('Estate / Inheritance', 'Insurance Claim', 'Personal Record', 'Other')),
    details                                   TEXT,
    request_reference                           VARCHAR(30) NOT NULL UNIQUE,
    status                                        VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required', 'Approved', 'Rejected')),
    rejection_reason                                TEXT,
    reviewed_by_user_id                               INTEGER REFERENCES users(user_id),
    reviewed_at                                         TIMESTAMPTZ,
    requested_at                                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_death_cert_req_citizen ON death_certificate_requests(citizen_id);
CREATE INDEX IF NOT EXISTS idx_death_cert_req_death_record ON death_certificate_requests(death_record_id);

CREATE TABLE IF NOT EXISTS name_change_requests (
    name_change_request_id   SERIAL PRIMARY KEY,
    citizen_id                  INTEGER NOT NULL REFERENCES citizens(citizen_id),
    request_reference             VARCHAR(30) NOT NULL UNIQUE,
    current_first_name            VARCHAR(80) NOT NULL,
    current_last_name               VARCHAR(80) NOT NULL,
    requested_first_name              VARCHAR(80) NOT NULL,
    requested_last_name                 VARCHAR(80) NOT NULL,
    reason_category                       VARCHAR(30) NOT NULL
        CHECK (reason_category IN ('Marriage', 'Divorce', 'Personal Preference', 'Religious', 'Correction of Error', 'Other')),
    reason_details                          TEXT NOT NULL,
    approval_reference                        VARCHAR(30) UNIQUE, -- assigned on approval
    status                                      VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required', 'Approved', 'Rejected')),
    rejection_reason                              TEXT,
    reviewed_by_user_id                             INTEGER REFERENCES users(user_id),
    reviewed_at                                       TIMESTAMPTZ,
    effective_date                                      DATE,
    requested_at                                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_name_change_citizen ON name_change_requests(citizen_id);
