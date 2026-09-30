-- 013_create_applications.sql
--
-- Umbrella tracking table used by the citizen-facing "My Applications" list / timeline UI,
-- across every department. Each department-specific table above is the source of truth for
-- its own workflow; this table is a normalised index over all of them so the frontend has one
-- place to query "everything this citizen has ever applied for" without a UNION across six
-- tables on every request. A row is created here whenever a department-specific application
-- is created, and its status is kept in sync by the relevant controller.

CREATE TABLE IF NOT EXISTS applications (
    application_id     SERIAL PRIMARY KEY,
    citizen_id           INTEGER NOT NULL REFERENCES citizens(citizen_id),
    department_id         INTEGER NOT NULL REFERENCES departments(department_id),
    service_type           VARCHAR(80) NOT NULL,
    reference_number        VARCHAR(30) NOT NULL UNIQUE,
    -- polymorphic link back to the department-specific record
    source_table             VARCHAR(40) NOT NULL, -- e.g. 'birth_records', 'national_id_cards'
    source_id                 INTEGER NOT NULL,
    status                    VARCHAR(40) NOT NULL,
    submitted_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at                 TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_reference ON applications(reference_number);
CREATE INDEX IF NOT EXISTS idx_applications_citizen ON applications(citizen_id);
CREATE INDEX IF NOT EXISTS idx_applications_department ON applications(department_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_source ON applications(source_table, source_id);
