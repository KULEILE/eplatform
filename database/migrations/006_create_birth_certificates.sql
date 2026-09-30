-- 006_create_birth_certificates.sql
--
-- Created only after a birth_record reaches 'Approved'. Distinguishes "certificate generated"
-- from "certificate physically collected" — the citizen must never be told they already have
-- the physical document when they have not collected it.

CREATE TABLE IF NOT EXISTS birth_certificates (
    birth_certificate_id   SERIAL PRIMARY KEY,
    citizen_id              INTEGER NOT NULL REFERENCES citizens(citizen_id),
    birth_record_id          INTEGER NOT NULL REFERENCES birth_records(birth_record_id),
    certificate_number       VARCHAR(30) NOT NULL UNIQUE,
    issue_date               DATE NOT NULL,
    status                   VARCHAR(30) NOT NULL DEFAULT 'Certificate Generated'
        CHECK (status IN (
            'Certificate Generated', 'Ready for Collection', 'Collected'
        )),
    collection_office_id     INTEGER, -- FK added after offices concept (appointments migration) if needed
    ready_for_collection_at  TIMESTAMPTZ,
    collected_at             TIMESTAMPTZ,
    is_demo_data             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_birth_certificates_number ON birth_certificates(certificate_number);
CREATE INDEX IF NOT EXISTS idx_birth_certificates_citizen ON birth_certificates(citizen_id);
