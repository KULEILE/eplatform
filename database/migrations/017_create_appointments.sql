-- 017_create_appointments.sql
-- Reserved for processes that genuinely require physical attendance: identity enrolment,
-- biometric capture, document collection, physical verification. Not every service needs one.

CREATE TABLE IF NOT EXISTS offices (
    office_id      SERIAL PRIMARY KEY,
    department_id    INTEGER NOT NULL REFERENCES departments(department_id),
    name              VARCHAR(120) NOT NULL,
    district          VARCHAR(80),
    address            VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
    appointment_id    SERIAL PRIMARY KEY,
    citizen_id           INTEGER NOT NULL REFERENCES citizens(citizen_id),
    application_id         INTEGER REFERENCES applications(application_id),
    department_id           INTEGER NOT NULL REFERENCES departments(department_id),
    office_id                 INTEGER REFERENCES offices(office_id),
    appointment_date            DATE NOT NULL,
    appointment_time             TIME NOT NULL,
    purpose                       VARCHAR(60) NOT NULL
        CHECK (purpose IN ('Identity Enrolment', 'Biometric Capture', 'Document Collection', 'Physical Verification')),
    status                         VARCHAR(20) NOT NULL DEFAULT 'Scheduled'
        CHECK (status IN ('Scheduled', 'Completed', 'Missed', 'Cancelled')),
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_citizen ON appointments(citizen_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);

-- Link collection FKs now that offices exists
ALTER TABLE birth_certificates
    ADD CONSTRAINT fk_birth_certificates_office FOREIGN KEY (collection_office_id) REFERENCES offices(office_id);
ALTER TABLE national_id_cards
    ADD CONSTRAINT fk_national_id_office FOREIGN KEY (collection_office_id) REFERENCES offices(office_id);
ALTER TABLE passport_records
    ADD CONSTRAINT fk_passport_office FOREIGN KEY (collection_office_id) REFERENCES offices(office_id);
