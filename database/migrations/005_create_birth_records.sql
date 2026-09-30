-- 005_create_birth_records.sql
--
-- Birth registration is a Home Affairs workflow. It does NOT immediately create a citizen
-- identity or a birth certificate. Both are created only when registration_status reaches
-- 'Approved' (see backend/src/controllers/homeAffairs.controller.js -> approveBirthRegistration).

CREATE TABLE IF NOT EXISTS birth_records (
    birth_record_id       SERIAL PRIMARY KEY,
    citizen_id             INTEGER REFERENCES citizens(citizen_id), -- filled in ONLY on approval
    parent_citizen_id      INTEGER NOT NULL REFERENCES citizens(citizen_id),
    registration_reference VARCHAR(30) NOT NULL UNIQUE,
    child_first_name       VARCHAR(80) NOT NULL,
    child_middle_name      VARCHAR(80),
    child_last_name        VARCHAR(80) NOT NULL,
    date_of_birth           DATE NOT NULL,
    place_of_birth          VARCHAR(120) NOT NULL,
    sex                     VARCHAR(20) NOT NULL CHECK (sex IN ('Male', 'Female', 'Other', 'Unspecified')),
    registration_status     VARCHAR(30) NOT NULL DEFAULT 'Draft'
        CHECK (registration_status IN (
            'Draft', 'Submitted', 'Under Review', 'Information Required',
            'Verification in Progress', 'Verified', 'Approved', 'Rejected'
        )),
    rejection_reason        TEXT,
    handling_officer_id     INTEGER, -- FK added after users table exists (see 019)
    submitted_at            TIMESTAMPTZ,
    verified_at             TIMESTAMPTZ,
    approved_at             TIMESTAMPTZ,
    is_demo_data            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_birth_records_reference ON birth_records(registration_reference);
CREATE INDEX IF NOT EXISTS idx_birth_records_parent ON birth_records(parent_citizen_id);
CREATE INDEX IF NOT EXISTS idx_birth_records_status ON birth_records(registration_status);
