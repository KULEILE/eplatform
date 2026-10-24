-- fix-national-id-columns.sql
--
-- Standalone, idempotent fix for "column biometric_office_id of relation national_id_cards does
-- not exist". Run this directly against your Render Postgres database — it does not depend on
-- the schema_migrations tracking table at all, so it is safe to run even if migration 063
-- somehow got marked as applied without actually running (or vice versa). Every statement below
-- uses IF NOT EXISTS / IF EXISTS, so running it twice, or against a database that already has
-- some of these columns, does nothing harmful either way.
--
-- This is the exact same content as database/migrations/063_national_id_eligibility_and_police_biometrics.sql
-- from Batch 7 — pulled out on its own so you can apply it directly without going through the
-- migration runner.

ALTER TABLE national_id_cards
    ADD COLUMN IF NOT EXISTS replacement_proof_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reported_lost_at DATE,
    ADD COLUMN IF NOT EXISTS biometric_office_id INTEGER REFERENCES offices(office_id),
    ADD COLUMN IF NOT EXISTS biometric_captured_by_user_id INTEGER REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS biometric_captured_at TIMESTAMPTZ;

ALTER TABLE national_id_cards DROP CONSTRAINT IF EXISTS national_id_cards_production_status_check;
ALTER TABLE national_id_cards ADD CONSTRAINT national_id_cards_production_status_check
    CHECK (production_status IN (
        'Application Submitted', 'Awaiting Biometric Capture', 'Under Review', 'Information Required',
        'Verification in Progress', 'Approved', 'Rejected', 'Card Production', 'Ready for Collection', 'Collected'
    ));

ALTER TABLE national_id_cards DROP CONSTRAINT IF EXISTS national_id_cards_replacement_reason_check;
ALTER TABLE national_id_cards ADD CONSTRAINT national_id_cards_replacement_reason_check
    CHECK (replacement_reason IN ('Lost', 'Stolen', 'Damaged'));

CREATE INDEX IF NOT EXISTS idx_national_id_biometric_office ON national_id_cards(biometric_office_id);

-- Marks migration 063 as applied in the tracking table too (if that table exists), so a future
-- `node database/run-migrations.js` run against this same database doesn't try to re-run it and
-- hit "column already exists" on the parts above. Harmless no-op if the table doesn't exist yet
-- or the row is already there.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations') THEN
        INSERT INTO schema_migrations (filename)
        VALUES ('063_national_id_eligibility_and_police_biometrics.sql')
        ON CONFLICT (filename) DO NOTHING;
    END IF;
END $$;

-- Quick confirmation you can read immediately after running this:
SELECT column_name FROM information_schema.columns
WHERE table_name = 'national_id_cards'
  AND column_name IN ('replacement_proof_reference', 'reported_lost_at', 'biometric_office_id', 'biometric_captured_by_user_id', 'biometric_captured_at')
ORDER BY column_name;
