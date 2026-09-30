-- 003_create_citizens.sql
--
-- THE CORE IDENTITY TABLE.
--
-- permanent_identity_number is generated exactly ONCE per person, at the moment their identity
-- record is officially established (normally on birth registration approval, or on manual
-- Home Affairs enrolment for an adult who was never registered digitally). It is never
-- regenerated — every later document (National ID card, passport, traffic/finance/pension/
-- police records) references this same number. See backend/src/utils/idGenerator.js.

CREATE TABLE IF NOT EXISTS citizens (
    citizen_id                 SERIAL PRIMARY KEY,
    permanent_identity_number   VARCHAR(20) NOT NULL UNIQUE,
    first_name                 VARCHAR(80) NOT NULL,
    middle_name                VARCHAR(80),
    last_name                  VARCHAR(80) NOT NULL,
    date_of_birth               DATE NOT NULL,
    place_of_birth              VARCHAR(120),
    sex                         VARCHAR(20) NOT NULL CHECK (sex IN ('Male', 'Female', 'Other', 'Unspecified')),
    citizenship_status          VARCHAR(30) NOT NULL DEFAULT 'Citizen'
                                    CHECK (citizenship_status IN ('Citizen', 'Naturalised', 'Permanent Resident', 'Pending')),
    biometric_status            VARCHAR(20) NOT NULL DEFAULT 'Not Enrolled'
                                    CHECK (biometric_status IN ('Not Enrolled', 'Enrolled')),
    identity_verification_status VARCHAR(20) NOT NULL DEFAULT 'Verified'
                                    CHECK (identity_verification_status IN ('Provisional', 'Pending', 'Verified')),
    -- self-referencing: a minor's record links to a parent/guardian citizen record
    parent_citizen_id           INTEGER REFERENCES citizens(citizen_id),
    is_demo_data                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_citizens_permanent_id ON citizens(permanent_identity_number);
CREATE INDEX IF NOT EXISTS idx_citizens_name ON citizens(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_citizens_dob ON citizens(date_of_birth);
