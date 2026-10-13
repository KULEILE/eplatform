-- 042_traffic_required_info_and_new_services.sql
--
-- Two things, together:
--
-- 1) Closes a real gap: traffic_records previously accepted a Driving Licence Application /
--    Renewal / Learner Permit with NOTHING beyond a bare serviceType — no photo, no fingerprint
--    scan, no collection branch. A driving licence identifies a specific person and is checked
--    by officers against that person's own enrolled biometrics, exactly like the National ID
--    card (see migrations 007/034/036) — so this adds the same photo_reference +
--    biometric_reference_left/right columns here, and traffic.controller.js's beforeApply now
--    requires them for every service type that issues a driving credential.
--
-- 2) Adds the columns needed by 8 new Traffic service types (see traffic.controller.js for which
--    columns are required for which serviceType — enforced server-side, not just in the UI):
--      - Driving Licence Replacement (lost/stolen/damaged)
--      - Public Driving Permit (for drivers of public transport vehicles)
--      - Vehicle Registration (Imported/SADC) — new imports, vehicles bought in South Africa, or
--        from another SADC country
--      - Vehicle Registration (Second-Hand Local) — second-hand vehicles already in Lesotho
--      - Vehicle Number Plate — new/lost/damaged/personalised plate requests
--      - Temporary Permit (Awaiting Registration) — short-term permit for a vehicle not yet
--        fully registered
--      - Vehicle Licence Disc Application / Renewal — the annual vehicle licence disc
--
-- All new columns are nullable: which ones are mandatory depends on serviceType and is enforced
-- in traffic.controller.js's beforeApply(), the same division of responsibility already used by
-- pensions.controller.js's age-eligibility check.

ALTER TABLE traffic_records
    -- Driving-credential identity capture (Application, Renewal, Learner Permit, Replacement,
    -- Public Driving Permit) — mirrors national_id_cards' photo_reference / biometric_reference_left/right.
    ADD COLUMN IF NOT EXISTS photo_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS biometric_reference_left VARCHAR(255),
    ADD COLUMN IF NOT EXISTS biometric_reference_right VARCHAR(255),
    ADD COLUMN IF NOT EXISTS preferred_office_id INTEGER REFERENCES offices(office_id),
    ADD COLUMN IF NOT EXISTS collection_office_id INTEGER REFERENCES offices(office_id),

    -- Driving Licence Replacement
    ADD COLUMN IF NOT EXISTS replacement_reason VARCHAR(20)
        CHECK (replacement_reason IN ('Lost', 'Stolen', 'Damaged', 'Other')),
    ADD COLUMN IF NOT EXISTS previous_licence_number VARCHAR(30),

    -- Public Driving Permit — issued against an existing driving licence, not a new one
    ADD COLUMN IF NOT EXISTS existing_licence_number VARCHAR(30),

    -- Vehicle identification, shared by both registration origins + transfer
    ADD COLUMN IF NOT EXISTS vehicle_make VARCHAR(60),
    ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR(60),
    ADD COLUMN IF NOT EXISTS chassis_number VARCHAR(40),
    ADD COLUMN IF NOT EXISTS engine_number VARCHAR(40),
    ADD COLUMN IF NOT EXISTS origin_country VARCHAR(60), -- Vehicle Registration (Imported/SADC) only
    ADD COLUMN IF NOT EXISTS ownership_proof_reference VARCHAR(255), -- photo of purchase/import/sale document
    ADD COLUMN IF NOT EXISTS new_owner_permanent_identity_number VARCHAR(20), -- Vehicle Transfer only

    -- Vehicle Number Plate
    ADD COLUMN IF NOT EXISTS plate_request_reason VARCHAR(20)
        CHECK (plate_request_reason IN ('New', 'Lost', 'Damaged', 'Personalised')),
    ADD COLUMN IF NOT EXISTS personalised_plate_text VARCHAR(20),

    -- Temporary Permit (Awaiting Registration)
    ADD COLUMN IF NOT EXISTS temporary_permit_valid_until DATE,

    -- Vehicle Licence Disc Application / Renewal
    ADD COLUMN IF NOT EXISTS insurance_proof_reference VARCHAR(255), -- photo of proof-of-insurance document
    ADD COLUMN IF NOT EXISTS previous_disc_number VARCHAR(30);

ALTER TABLE traffic_records DROP CONSTRAINT IF EXISTS traffic_records_service_type_check;
ALTER TABLE traffic_records ADD CONSTRAINT traffic_records_service_type_check
    CHECK (service_type IN (
        'Driving Licence Application', 'Driving Licence Renewal', 'Vehicle Registration',
        'Vehicle Transfer', 'Learner Permit',
        'Driving Licence Replacement', 'Public Driving Permit',
        'Vehicle Registration (Imported/SADC)', 'Vehicle Registration (Second-Hand Local)',
        'Vehicle Number Plate', 'Temporary Permit (Awaiting Registration)',
        'Vehicle Licence Disc Application', 'Vehicle Licence Disc Renewal'
    ));

CREATE INDEX IF NOT EXISTS idx_traffic_service_type ON traffic_records(service_type);
