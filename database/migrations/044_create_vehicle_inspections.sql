-- 044_create_vehicle_inspections.sql
--
-- Roadworthiness test + Certificate of Fitness (COF), combined into one workflow: the COF is
-- the outcome of passing the inspection, not a separate application — exactly like a driving
-- licence number is the outcome of approving a Driving Licence Application, not something
-- applied for separately. Uses the same simpleDepartmentController factory as traffic_records
-- (see traffic.controller.js) since it is the same shape: citizen applies -> officer reviews ->
-- approves (which assigns the cof_number) or rejects.
--
-- beforeApply requires vehicleRegistrationNumber to match a vehicle registration the citizen
-- already holds (Approved or Collected) — you cannot book a roadworthiness test for a vehicle
-- that isn't registered, or someone else's vehicle.

CREATE TABLE IF NOT EXISTS vehicle_inspections (
    vehicle_inspection_id    SERIAL PRIMARY KEY,
    citizen_id                INTEGER NOT NULL REFERENCES citizens(citizen_id),
    application_reference     VARCHAR(30) NOT NULL UNIQUE,
    service_type               VARCHAR(60) NOT NULL
        CHECK (service_type IN ('Roadworthiness Test & Certificate of Fitness')),
    vehicle_registration_number VARCHAR(30) NOT NULL,
    office_id                   INTEGER REFERENCES offices(office_id), -- inspection centre
    cof_number                   VARCHAR(30) UNIQUE, -- assigned on approval (pass)
    cof_issue_date                DATE,
    cof_expiry_date                DATE,
    status                         VARCHAR(40) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN (
            'Draft', 'Submitted', 'Under Review', 'Documents Checked', 'Processing',
            'Additional Information Required', 'Approved', 'Rejected'
        )),
    rejection_reason                TEXT,
    is_demo_data                     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_citizen ON vehicle_inspections(citizen_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_status ON vehicle_inspections(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_inspections_vehicle ON vehicle_inspections(vehicle_registration_number);
