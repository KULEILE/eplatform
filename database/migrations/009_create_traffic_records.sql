-- 009_create_traffic_records.sql
-- Driving licence and vehicle services. Traffic never receives more than verified identity +
-- service-specific detail (minimum necessary access).

CREATE TABLE IF NOT EXISTS traffic_records (
    traffic_record_id      SERIAL PRIMARY KEY,
    citizen_id               INTEGER NOT NULL REFERENCES citizens(citizen_id),
    application_reference    VARCHAR(30) NOT NULL UNIQUE,
    service_type              VARCHAR(40) NOT NULL
        CHECK (service_type IN ('Driving Licence Application', 'Driving Licence Renewal',
                                 'Vehicle Registration', 'Vehicle Transfer', 'Learner Permit')),
    licence_number             VARCHAR(30),
    vehicle_registration_number VARCHAR(30),
    status                     VARCHAR(40) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN (
            'Draft', 'Submitted', 'Under Review', 'Identity Verified', 'Documents Checked',
            'Processing', 'Additional Information Required', 'Approved', 'Rejected',
            'Ready for Collection', 'Collected'
        )),
    rejection_reason            TEXT,
    issue_date                   DATE,
    expiry_date                  DATE,
    ready_for_collection_at      TIMESTAMPTZ,
    collected_at                 TIMESTAMPTZ,
    is_demo_data                  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traffic_citizen ON traffic_records(citizen_id);
CREATE INDEX IF NOT EXISTS idx_traffic_status ON traffic_records(status);
