-- 011_create_pension_records.sql
-- Pension beneficiary verification / "proof of life" workflow, linked to identity so a
-- legitimate beneficiary who is incorrectly flagged has a correction path.

CREATE TABLE IF NOT EXISTS pension_records (
    pension_record_id       SERIAL PRIMARY KEY,
    citizen_id                INTEGER NOT NULL REFERENCES citizens(citizen_id),
    application_reference     VARCHAR(30) NOT NULL UNIQUE,
    service_type               VARCHAR(50) NOT NULL
        CHECK (service_type IN ('New Pension Enrolment', 'Proof of Life Verification',
                                 'Beneficiary Correction', 'Pension Status Enquiry')),
    life_status                 VARCHAR(20) NOT NULL DEFAULT 'Alive'
        CHECK (life_status IN ('Alive', 'Deceased', 'Under Review')),
    status                      VARCHAR(40) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN (
            'Draft', 'Submitted', 'Under Review', 'Identity Verified',
            'Processing', 'Additional Information Required', 'Approved', 'Rejected',
            'Flagged for Correction', 'Completed'
        )),
    rejection_reason             TEXT,
    is_demo_data                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pension_citizen ON pension_records(citizen_id);
CREATE INDEX IF NOT EXISTS idx_pension_status ON pension_records(status);
