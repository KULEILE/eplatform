-- 046_create_driving_instructor_registrations.sql
--
-- Driving instructor & examiner certification — an internal admin registry, the same shape as
-- marriage_officer_registrations (migration 040): there is no citizen "applicant" here, a
-- Traffic officer or system administrator creates and maintains these records directly.
-- certification_type covers both instructors (who train learners at driving schools) and
-- examiners (who conduct the practical test) as one registry rather than two near-identical
-- tables.

CREATE TABLE IF NOT EXISTS driving_instructor_registrations (
    driving_instructor_registration_id SERIAL PRIMARY KEY,
    full_name                             VARCHAR(150) NOT NULL,
    certification_type                       VARCHAR(20) NOT NULL CHECK (certification_type IN ('Instructor', 'Examiner')),
    driving_school_or_authority                 VARCHAR(150),
    district_id                                    INTEGER REFERENCES districts(district_id),
    licence_or_certificate_number                     VARCHAR(30) UNIQUE,
    status                                               VARCHAR(20) NOT NULL DEFAULT 'Registered'
        CHECK (status IN ('Registered', 'Suspended', 'Revoked')),
    notes                                                  TEXT,
    registered_by_user_id                                    INTEGER REFERENCES users(user_id),
    registered_at                                              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status_changed_by_user_id                                    INTEGER REFERENCES users(user_id),
    status_changed_at                                              TIMESTAMPTZ,
    created_at                                                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                                         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driving_instructor_district ON driving_instructor_registrations(district_id);
CREATE INDEX IF NOT EXISTS idx_driving_instructor_status ON driving_instructor_registrations(status);
