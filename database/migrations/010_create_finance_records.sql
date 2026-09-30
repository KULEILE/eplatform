-- 010_create_finance_records.sql
-- Finance services requiring identity verification (e.g. supplier/payment registration
-- validation). Sensitive financial detail is never exposed to other departments.

CREATE TABLE IF NOT EXISTS finance_records (
    finance_record_id       SERIAL PRIMARY KEY,
    citizen_id                INTEGER NOT NULL REFERENCES citizens(citizen_id),
    application_reference     VARCHAR(30) NOT NULL UNIQUE,
    service_type               VARCHAR(50) NOT NULL
        CHECK (service_type IN ('Supplier Registration Validation', 'Payment Information Update',
                                 'Tax Identity Confirmation', 'Financial Records Correction')),
    status                     VARCHAR(40) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN (
            'Draft', 'Submitted', 'Under Review', 'Identity Verified', 'Documents Checked',
            'Processing', 'Additional Information Required', 'Approved', 'Rejected', 'Completed'
        )),
    rejection_reason            TEXT,
    validated_information_note   TEXT, -- non-sensitive summary only, never raw account data
    is_demo_data                  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_citizen ON finance_records(citizen_id);
CREATE INDEX IF NOT EXISTS idx_finance_status ON finance_records(status);
