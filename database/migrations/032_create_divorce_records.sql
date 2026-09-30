-- 032_create_divorce_records.sql
-- Divorce registration. A Lesotho court (not Home Affairs) grants a divorce; Home Affairs
-- registers the fact of it against a court order. This table therefore requires the court's own
-- reference rather than asking the citizen to state a reason — the system administratively
-- records a legal fact, it does not adjudicate one.

CREATE TABLE IF NOT EXISTS divorce_records (
    divorce_record_id      SERIAL PRIMARY KEY,
    filer_citizen_id          INTEGER NOT NULL REFERENCES citizens(citizen_id),
    registration_reference       VARCHAR(30) NOT NULL UNIQUE,

    spouse_name                     VARCHAR(150) NOT NULL,
    spouse_permanent_identity_number   VARCHAR(20),
    marriage_reference                    VARCHAR(60),  -- free text: this system's marriage certificate number, or an external one

    court_name                               VARCHAR(150) NOT NULL,
    court_order_reference                       VARCHAR(60) NOT NULL,
    divorce_order_date                             DATE NOT NULL,

    preferred_office_id                               INTEGER REFERENCES offices(office_id),
    status                                               VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required',
                           'Verified', 'Approved', 'Rejected')),
    certificate_number                                      VARCHAR(30) UNIQUE,
    rejection_reason                                           TEXT,
    submitted_at                                                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at                                                      TIMESTAMPTZ,
    created_at                                                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_divorce_records_filer ON divorce_records(filer_citizen_id);
CREATE INDEX IF NOT EXISTS idx_divorce_records_status ON divorce_records(status);
