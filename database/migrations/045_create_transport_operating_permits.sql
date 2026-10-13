-- 045_create_transport_operating_permits.sql
--
-- Transport operating permit (goods/passenger categories A-F, grouped into one workflow with a
-- permit_category field rather than six near-identical tables) and its renewal, as two
-- service_type values on the same table — same reasoning as grouping vehicle registration by
-- origin instead of per-origin tables.
--
-- beforeApply requires an Approved vehicle_inspections row (a valid, unexpired Certificate of
-- Fitness) for the given vehicle_registration_number, owned by the applying citizen: a vehicle
-- must be confirmed roadworthy before it can be licensed to carry goods or passengers
-- commercially. Renewal additionally requires previous_permit_number.

CREATE TABLE IF NOT EXISTS transport_operating_permits (
    transport_operating_permit_id SERIAL PRIMARY KEY,
    citizen_id                      INTEGER NOT NULL REFERENCES citizens(citizen_id),
    application_reference            VARCHAR(30) NOT NULL UNIQUE,
    service_type                      VARCHAR(20) NOT NULL CHECK (service_type IN ('New', 'Renewal')),
    vehicle_registration_number       VARCHAR(30) NOT NULL,
    permit_category                   VARCHAR(5) NOT NULL CHECK (permit_category IN ('A', 'B', 'C', 'D', 'E', 'F')),
    operating_route_or_area            TEXT NOT NULL,
    previous_permit_number              VARCHAR(30), -- required when service_type = 'Renewal'
    permit_number                        VARCHAR(30) UNIQUE, -- assigned on approval
    valid_from                            DATE,
    valid_until                           DATE,
    status                                 VARCHAR(40) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN (
            'Draft', 'Submitted', 'Under Review', 'Documents Checked', 'Processing',
            'Additional Information Required', 'Approved', 'Rejected'
        )),
    rejection_reason                        TEXT,
    is_demo_data                             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_permits_citizen ON transport_operating_permits(citizen_id);
CREATE INDEX IF NOT EXISTS idx_transport_permits_status ON transport_operating_permits(status);
CREATE INDEX IF NOT EXISTS idx_transport_permits_vehicle ON transport_operating_permits(vehicle_registration_number);
