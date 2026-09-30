-- 008_create_passport_records.sql
-- Passport Services is organisationally grouped under Home Affairs but modelled as its own
-- service table like the other departments, reusing the citizen's verified identity.

CREATE TABLE IF NOT EXISTS passport_records (
    passport_record_id     SERIAL PRIMARY KEY,
    citizen_id               INTEGER NOT NULL REFERENCES citizens(citizen_id),
    passport_number          VARCHAR(30) UNIQUE, -- assigned on approval, NULL before then
    application_reference    VARCHAR(30) NOT NULL UNIQUE,
    passport_type            VARCHAR(20) NOT NULL DEFAULT 'Ordinary'
        CHECK (passport_type IN ('Ordinary', 'Diplomatic', 'Official')),
    status                   VARCHAR(40) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN (
            'Draft', 'Submitted', 'Under Review', 'Identity Verified', 'Documents Checked',
            'Processing', 'Additional Information Required', 'Approved', 'Rejected',
            'Passport Produced', 'Ready for Collection', 'Collected'
        )),
    rejection_reason          TEXT,
    issue_date                 DATE,
    expiry_date                DATE,
    collection_office_id       INTEGER,
    ready_for_collection_at    TIMESTAMPTZ,
    collected_at               TIMESTAMPTZ,
    is_demo_data                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passport_citizen ON passport_records(citizen_id);
CREATE INDEX IF NOT EXISTS idx_passport_status ON passport_records(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_reference ON passport_records(application_reference);
