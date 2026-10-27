-- Batch 30 — "car fitness need physical attendance ... car registration also need physical check
-- of officers ... citizen can fill the form then take a car to traffic so that officer can confirm
-- that is true then approve registration" + realistic Imported/SADC paperwork (researched against
-- Lesotho's own published requirements for a SADC-country import: manufacturing certificate,
-- change-of-ownership form, customs clearance Form CE 11, VAT payment proof, CID/Interpol (SARPCO)
-- clearance — see batch30 README for sources) + the linkage an auto-generated Temporary Permit and
-- Number Plate need back to the Vehicle Registration that produced them.

-- traffic_records: a Vehicle Registration (any of its three service_type variants — 'Vehicle
-- Registration', 'Vehicle Registration (Imported/SADC)', 'Vehicle Registration (Second-Hand
-- Local)' — unchanged from migration 042; the "stop duplicating it as separate services" fix in
-- this batch is a presentational one, one page with a selector, the same way Driving Licence's
-- Application/Renewal/Replacement already work — see traffic.controller.js and
-- frontend/src/pages/traffic/VehicleRegistration.jsx) now needs an officer to confirm the vehicle
-- was physically brought in and inspected before it can be approved — the same gate
-- vehicle_inspections (Roadworthiness/Certificate of Fitness) gets below, and for the same reason:
-- a document-only review was never enough to confirm a chassis/engine number actually matches a
-- real vehicle.
ALTER TABLE traffic_records
  ADD COLUMN IF NOT EXISTS physical_inspection_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS physical_inspection_confirmed_by_user_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS physical_inspection_notes TEXT,
  -- Imported/SADC registration only — researched against gov.ls's own published SADC-import
  -- requirements. ownership_proof_reference (migration 042) already covers the garage
  -- invoice/manufacturing certificate; these three are the paperwork that's genuinely different
  -- for an import and wasn't captured by any existing column.
  ADD COLUMN IF NOT EXISTS customs_clearance_reference VARCHAR(50),
  ADD COLUMN IF NOT EXISTS police_clearance_reference VARCHAR(255),
  ADD COLUMN IF NOT EXISTS import_tax_proof_reference VARCHAR(255),
  -- Set only on a Temporary Permit or Vehicle Number Plate row the system generated automatically
  -- (never by a citizen's own application — see traffic.controller.js's afterTransition and
  -- sweepExpiredTemporaryPermits): points back at the traffic_record_id of the Vehicle
  -- Registration that produced it, so the two stay traceable to each other.
  ADD COLUMN IF NOT EXISTS linked_registration_id INTEGER REFERENCES traffic_records(traffic_record_id);

CREATE INDEX IF NOT EXISTS idx_traffic_linked_registration ON traffic_records(linked_registration_id);

ALTER TABLE traffic_records DROP CONSTRAINT IF EXISTS traffic_records_status_check;
ALTER TABLE traffic_records ADD CONSTRAINT traffic_records_status_check
    CHECK (status IN (
        'Draft', 'Submitted', 'Under Review', 'Identity Verified', 'Documents Checked',
        'Physically Inspected', 'Processing', 'Additional Information Required', 'Approved',
        'Rejected', 'Ready for Collection', 'Collected'
    ));

-- vehicle_inspections (Roadworthiness Test & Certificate of Fitness): "car fitness need physical
-- attendance so that officer can check they citizen can not obtain fitness certificate without
-- taking car to traffic" — confirmed against Lesotho's own published procedure (wikiprocedure.com's
-- Lesotho Vehicle Roadworthy Certificate page): the vehicle itself must be taken to the test
-- centre, form T.C. 12 is filled there. Previously this workflow only ever reviewed documents —
-- Submitted -> Under Review -> Documents Checked -> Processing -> Approved — with nothing that
-- actually required the vehicle to show up. 'Physically Inspected' is now a mandatory stop between
-- Documents Checked and Processing (see trafficServices2.controller.js's vehicleInspectionsController).
ALTER TABLE vehicle_inspections
  ADD COLUMN IF NOT EXISTS physical_inspection_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS physical_inspection_confirmed_by_user_id INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS physical_inspection_notes TEXT;

ALTER TABLE vehicle_inspections DROP CONSTRAINT IF EXISTS vehicle_inspections_status_check;
ALTER TABLE vehicle_inspections ADD CONSTRAINT vehicle_inspections_status_check
    CHECK (status IN (
        'Draft', 'Submitted', 'Under Review', 'Documents Checked', 'Physically Inspected',
        'Processing', 'Additional Information Required', 'Approved', 'Rejected'
    ));
