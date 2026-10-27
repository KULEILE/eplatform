-- Batch 31 — follow-up to migration 074, from a written workflow document the citizen supplied
-- ("VEHICLE REGISTRATION: IMPORTED VEHICLES") specifying the real citizen-facing workflow for
-- registering an imported vehicle, grounded in Revenue Services Lesotho's (RSL) actual customs
-- process sitting outside this platform.
--
-- Two changes:
--
-- 1. "Keep customs verification separate from document uploading" (document Section 10) — an
--    officer confirming they RECEIVED the RSL documents (the generic 'check-documents' step) is
--    not the same thing as an officer confirming those documents are genuine and the customs
--    clearance is real. That needs its own explicit step, with its own audit trail, distinct from
--    the physical-inspection step migration 074 already added — these are two different checks
--    (paperwork vs. the actual vehicle) that can happen in either order relative to each other but
--    both must happen before approval. A new status, 'Customs Clearance Verified', sits between
--    'Documents Checked' and 'Physically Inspected' for the two registration categories that
--    actually involve an import (see traffic.controller.js's VEHICLE_REGISTRATION_REQUIREMENTS);
--    a locally-purchased brand-new vehicle has no customs paperwork and skips straight to the
--    existing physical-inspection step, unaffected by this migration.
--
-- 2. The document's 4 real-world categories for Vehicle Registration are: brand-new bought
--    locally, brand-new imported, second-hand imported, and (handled by the EXISTING Vehicle
--    Transfer service, not duplicated here — see the Batch 31 README) a change of ownership on a
--    vehicle already registered in Lesotho. Batch 30's third category, 'Vehicle Registration
--    (Second-Hand Local)', didn't correspond to any of these — it was never clear what real-world
--    situation it covered that wasn't actually either an import or an ownership transfer. It's
--    renamed here to 'Vehicle Registration (Second-Hand Imported)', which does correspond to a
--    real category in the document and needs the same customs paperwork as a brand-new import.

-- --- 1. Customs-clearance verification columns + status -----------------------------------

ALTER TABLE traffic_records
  ADD COLUMN IF NOT EXISTS customs_clearance_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customs_clearance_verified_by_user_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS customs_clearance_verification_notes TEXT;

ALTER TABLE traffic_records DROP CONSTRAINT IF EXISTS traffic_records_status_check;
ALTER TABLE traffic_records ADD CONSTRAINT traffic_records_status_check CHECK (
  status IN (
    'Draft', 'Submitted', 'Under Review', 'Identity Verified', 'Documents Checked',
    'Customs Clearance Verified', 'Physically Inspected', 'Processing',
    'Additional Information Required', 'Approved', 'Rejected', 'Ready for Collection', 'Collected'
  )
);

-- --- 2. Rename 'Vehicle Registration (Second-Hand Local)' -> '... (Second-Hand Imported)' ---
-- Must widen the service_type constraint to allow BOTH strings before the UPDATE, then narrow it
-- back down to only the new one once every row has been moved over.
--
-- 'Vehicle Registration (Second-Hand Imported)' is 43 characters — 3 over the existing
-- service_type VARCHAR(40) limit ('...Second-Hand Local)' happened to fit exactly at 40). Widening
-- a VARCHAR's limit is a metadata-only change in Postgres (no table rewrite), so this is safe to
-- run against a live table of any size.
ALTER TABLE traffic_records ALTER COLUMN service_type TYPE VARCHAR(60);

ALTER TABLE traffic_records DROP CONSTRAINT IF EXISTS traffic_records_service_type_check;
ALTER TABLE traffic_records ADD CONSTRAINT traffic_records_service_type_check CHECK (
  service_type IN (
    'Driving Licence Application', 'Driving Licence Renewal', 'Vehicle Registration',
    'Vehicle Transfer', 'Learner Permit', 'Driving Licence Replacement', 'Public Driving Permit',
    'Vehicle Registration (Imported/SADC)', 'Vehicle Registration (Second-Hand Local)',
    'Vehicle Registration (Second-Hand Imported)',
    'Vehicle Number Plate', 'Temporary Permit (Awaiting Registration)',
    'Vehicle Licence Disc Application', 'Vehicle Licence Disc Renewal'
  )
);

UPDATE traffic_records
SET service_type = 'Vehicle Registration (Second-Hand Imported)'
WHERE service_type = 'Vehicle Registration (Second-Hand Local)';

ALTER TABLE traffic_records DROP CONSTRAINT IF EXISTS traffic_records_service_type_check;
ALTER TABLE traffic_records ADD CONSTRAINT traffic_records_service_type_check CHECK (
  service_type IN (
    'Driving Licence Application', 'Driving Licence Renewal', 'Vehicle Registration',
    'Vehicle Transfer', 'Learner Permit', 'Driving Licence Replacement', 'Public Driving Permit',
    'Vehicle Registration (Imported/SADC)', 'Vehicle Registration (Second-Hand Imported)',
    'Vehicle Number Plate', 'Temporary Permit (Awaiting Registration)',
    'Vehicle Licence Disc Application', 'Vehicle Licence Disc Renewal'
  )
);
