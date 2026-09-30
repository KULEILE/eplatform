-- 020_create_corrections_and_death.sql
-- Supports FR12 (Error correction) and Death Registration, both explicitly required Home
-- Affairs services. Corrections is generic across departments (a citizen can report an error
-- in Home Affairs identity data OR request a beneficiary correction in Pensions, etc.).

ALTER TABLE citizens ADD COLUMN IF NOT EXISTS is_deceased BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS date_of_death DATE;

CREATE TABLE IF NOT EXISTS corrections (
    correction_id       SERIAL PRIMARY KEY,
    citizen_id             INTEGER NOT NULL REFERENCES citizens(citizen_id),
    requested_by_user_id     INTEGER NOT NULL REFERENCES users(user_id),
    department_id              INTEGER NOT NULL REFERENCES departments(department_id),
    field_name                   VARCHAR(80) NOT NULL,
    current_value                 TEXT,
    requested_value                TEXT NOT NULL,
    reason                          TEXT NOT NULL,
    status                          VARCHAR(20) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Approved', 'Rejected')),
    reviewed_by_user_id               INTEGER REFERENCES users(user_id),
    reviewed_at                         TIMESTAMPTZ,
    created_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_corrections_citizen ON corrections(citizen_id);

CREATE TABLE IF NOT EXISTS death_records (
    death_record_id        SERIAL PRIMARY KEY,
    citizen_id                INTEGER NOT NULL REFERENCES citizens(citizen_id),
    reported_by_citizen_id      INTEGER NOT NULL REFERENCES citizens(citizen_id),
    registration_reference        VARCHAR(30) NOT NULL UNIQUE,
    date_of_death                    DATE NOT NULL,
    place_of_death                     VARCHAR(120),
    status                               VARCHAR(20) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Verified', 'Approved', 'Rejected')),
    handling_officer_id                   INTEGER REFERENCES users(user_id),
    submitted_at                             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at                                TIMESTAMPTZ,
    created_at                                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_death_records_citizen ON death_records(citizen_id);
