-- 012_create_police_records.sql
--
-- Police identity-verification lookups. Every row here represents a controlled, purpose-
-- justified identity check — NOT open browsing of citizen data. A matching audit_logs entry
-- is always created alongside this (see backend/src/controllers/police.controller.js).

CREATE TABLE IF NOT EXISTS police_records (
    police_record_id     SERIAL PRIMARY KEY,
    citizen_id             INTEGER REFERENCES citizens(citizen_id), -- nullable: lookup may find no match
    officer_user_id         INTEGER, -- FK added in 019 after users exists
    lookup_reference         VARCHAR(30) NOT NULL UNIQUE,
    purpose                  VARCHAR(255) NOT NULL, -- officer-supplied lawful operational reason
    provided_name             VARCHAR(160), -- name/alias the subject provided, if any
    verification_result       VARCHAR(20) NOT NULL DEFAULT 'Pending'
        CHECK (verification_result IN ('Pending', 'Match Found', 'No Match', 'Possible Mismatch')),
    case_reference             VARCHAR(60),
    status                     VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Processing', 'Completed', 'Escalated')),
    is_demo_data                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_police_citizen ON police_records(citizen_id);
CREATE INDEX IF NOT EXISTS idx_police_officer ON police_records(officer_user_id);
