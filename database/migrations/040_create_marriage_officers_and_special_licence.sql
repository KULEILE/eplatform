-- 040_create_marriage_officers_and_special_licence.sql
--
-- Two new Home Affairs services:
--   1. Registration of marriage officers — an internal admin registry of the people authorised
--      to perform civil/religious/traditional marriages. There is no citizen "applicant" here;
--      a Home Affairs officer or system administrator creates and maintains these records
--      directly, the same devolved-admin shape districts/offices already use (migration 022).
--   2. Special marriage licence — a licence for a marriage that doesn't fit the standard
--      marriage-registration flow (migration 031): a foreign-national spouse, an expedited
--      licence, or a minor marrying with consent. Distinct from ordinary marriage registration,
--      which records a marriage that has already taken place.

CREATE TABLE IF NOT EXISTS marriage_officer_registrations (
    marriage_officer_registration_id  SERIAL PRIMARY KEY,
    full_name                            VARCHAR(150) NOT NULL,
    officiant_type                          VARCHAR(20) NOT NULL CHECK (officiant_type IN ('Religious', 'Civil', 'Traditional Chief')),
    authority_or_denomination                 VARCHAR(150),
    district_id                                 INTEGER REFERENCES districts(district_id),
    licence_number                                VARCHAR(30) UNIQUE,
    status                                          VARCHAR(20) NOT NULL DEFAULT 'Registered'
        CHECK (status IN ('Registered', 'Suspended', 'Revoked')),
    notes                                             TEXT,
    registered_by_user_id                               INTEGER REFERENCES users(user_id),
    registered_at                                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status_changed_by_user_id                               INTEGER REFERENCES users(user_id),
    status_changed_at                                         TIMESTAMPTZ,
    created_at                                                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marriage_officer_district ON marriage_officer_registrations(district_id);
CREATE INDEX IF NOT EXISTS idx_marriage_officer_status ON marriage_officer_registrations(status);

CREATE TABLE IF NOT EXISTS special_marriage_licence_requests (
    licence_request_id        SERIAL PRIMARY KEY,
    citizen_id                   INTEGER NOT NULL REFERENCES citizens(citizen_id), -- the filer
    spouse1_name                    VARCHAR(150) NOT NULL,
    spouse1_permanent_identity_number  VARCHAR(20),
    spouse2_name                          VARCHAR(150) NOT NULL,
    spouse2_nationality                      VARCHAR(80),
    spouse2_permanent_identity_number           VARCHAR(20),
    special_reason                                 VARCHAR(40) NOT NULL
        CHECK (special_reason IN ('Foreign National Spouse', 'Urgent / Expedited', 'Minor With Consent', 'Other')),
    reason_details                                   TEXT NOT NULL,
    licence_reference                                  VARCHAR(30) NOT NULL UNIQUE,
    licence_number                                       VARCHAR(30) UNIQUE, -- assigned on approval
    valid_from                                             DATE,
    valid_until                                              DATE,
    status                                                     VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required', 'Approved', 'Rejected')),
    rejection_reason                                             TEXT,
    reviewed_by_user_id                                            INTEGER REFERENCES users(user_id),
    reviewed_at                                                      TIMESTAMPTZ,
    requested_at                                                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                                           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_special_licence_citizen ON special_marriage_licence_requests(citizen_id);
