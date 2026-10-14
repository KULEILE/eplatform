-- 047_passport_renewal.sql
--
-- New Passport service: renewal. Mirrors how National ID renewal/replacement was added in
-- migration 037 — reuses this same passport_records table/approval pipeline (a renewal is still,
-- physically, a new passport application going through the same review -> approve -> produce ->
-- collect steps) rather than a parallel table, distinguished by application_type.
--
-- Passport renewal only (no "Replacement" type here, unlike National ID) — that is the service
-- that was requested; a lost/stolen/damaged passport can be added the same way later if needed.

ALTER TABLE passport_records
    ADD COLUMN IF NOT EXISTS application_type VARCHAR(20) NOT NULL DEFAULT 'New'
        CHECK (application_type IN ('New', 'Renewal')),
    ADD COLUMN IF NOT EXISTS previous_passport_number VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_passport_application_type ON passport_records(application_type);
