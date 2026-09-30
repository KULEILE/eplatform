-- 029_create_police_clearance_requests.sql
-- A Police Clearance Certificate — a citizen-facing self-service request, deliberately kept
-- separate from police_records (migration 012), which is the officer-initiated, purpose-bound
-- identity-verification lookup tool used for investigations. These are different services with
-- different actors and different privacy postures; they should not share a table.

CREATE TABLE IF NOT EXISTS police_clearance_requests (
    clearance_record_id   SERIAL PRIMARY KEY,
    citizen_id                INTEGER NOT NULL REFERENCES citizens(citizen_id),
    application_reference        VARCHAR(30) NOT NULL UNIQUE,
    service_type                    VARCHAR(50) NOT NULL DEFAULT 'Police Clearance Certificate'
        CHECK (service_type IN ('Police Clearance Certificate')),
    purpose                            VARCHAR(40) NOT NULL
        CHECK (purpose IN ('Employment', 'Travel or Visa', 'Education', 'Immigration', 'Other')),
    preferred_office_id                   INTEGER REFERENCES offices(office_id),
    status                                   VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Background Check In Progress',
                           'Approved', 'Rejected', 'Ready for Collection', 'Collected')),
    certificate_number                          VARCHAR(30) UNIQUE,
    issue_date                                     DATE,
    -- Set by the officer during the background check (approve step defaults to 'Clean Record'
    -- unless the officer records otherwise). officer_notes is internal only — never printed on
    -- the certificate itself, which states only the clearance_result.
    clearance_result                                  VARCHAR(20) DEFAULT 'Clean Record'
        CHECK (clearance_result IN ('Clean Record', 'Record Found')),
    officer_notes                                        TEXT,
    rejection_reason                                        TEXT,
    is_demo_data                                        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                                             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_police_clearance_citizen ON police_clearance_requests(citizen_id);
CREATE INDEX IF NOT EXISTS idx_police_clearance_status ON police_clearance_requests(status);
