-- 056_finance_pension_new_services.sql
--
-- Backend support for the Finance / Pensions update:
--   1. Government Supplier Payment Tracking  (finance_records, new status 'Paid')
--   2. Finance Complaint or Enquiry           (finance_records, officer writes a response)
--   3. Budget and Tender publications          (new finance_publications table)
--   4. Pension Enquiry and Tracking            (pension_records 'Pension Status Enquiry' now
--                                               carries the citizen's question + officer response)
-- Retirement Benefits Tracking needs no schema change: it only reads existing records.

-- ---------- finance_records: two new service types ----------
ALTER TABLE finance_records DROP CONSTRAINT IF EXISTS finance_records_service_type_check;
ALTER TABLE finance_records ADD CONSTRAINT finance_records_service_type_check
    CHECK (service_type IN (
        'Supplier Registration Validation', 'Payment Information Update',
        'Tax Identity Confirmation', 'Financial Records Correction',
        'Government Employee Retirement Declaration',
        'Government Supplier Payment Tracking', 'Finance Complaint or Enquiry'
    ));

-- ---------- finance_records: new final status 'Paid' (supplier payments only) ----------
ALTER TABLE finance_records DROP CONSTRAINT IF EXISTS finance_records_status_check;
ALTER TABLE finance_records ADD CONSTRAINT finance_records_status_check
    CHECK (status IN (
        'Draft', 'Submitted', 'Under Review', 'Identity Verified', 'Documents Checked',
        'Processing', 'Additional Information Required', 'Approved', 'Rejected', 'Completed',
        'Paid'
    ));

-- ---------- finance_records: columns for the new services ----------
ALTER TABLE finance_records
    ADD COLUMN IF NOT EXISTS supplier_name        VARCHAR(150),
    ADD COLUMN IF NOT EXISTS invoice_number       VARCHAR(60),
    ADD COLUMN IF NOT EXISTS invoice_amount       NUMERIC(14, 2) CHECK (invoice_amount IS NULL OR invoice_amount > 0),
    ADD COLUMN IF NOT EXISTS invoice_date         DATE,
    ADD COLUMN IF NOT EXISTS paid_at              TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS complaint_text       TEXT,
    ADD COLUMN IF NOT EXISTS evidence_reference   VARCHAR(255),
    ADD COLUMN IF NOT EXISTS officer_response     TEXT,
    ADD COLUMN IF NOT EXISTS responded_at         TIMESTAMPTZ;

-- ---------- pension_records: enquiry question + officer response ----------
ALTER TABLE pension_records
    ADD COLUMN IF NOT EXISTS enquiry_text      TEXT,
    ADD COLUMN IF NOT EXISTS officer_response  TEXT,
    ADD COLUMN IF NOT EXISTS responded_at      TIMESTAMPTZ;

-- ---------- Budget documents and tender announcements ----------
-- Published by Finance officers, readable by every signed-in user. The file bytes live in
-- file_blobs (migration 050) like every other upload; file_reference is its file_key.
CREATE TABLE IF NOT EXISTS finance_publications (
    publication_id     SERIAL PRIMARY KEY,
    publication_type   VARCHAR(30) NOT NULL
        CHECK (publication_type IN ('Budget Document', 'Tender Announcement')),
    title              VARCHAR(200) NOT NULL,
    description        TEXT,
    fiscal_year        VARCHAR(20),
    tender_deadline    DATE,
    file_reference     VARCHAR(255) NOT NULL,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    published_by       INTEGER REFERENCES users(user_id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_publications_type ON finance_publications(publication_type);
CREATE INDEX IF NOT EXISTS idx_finance_publications_active ON finance_publications(is_active);
