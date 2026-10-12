-- 039_create_adoption_and_burial.sql
--
-- Two new Home Affairs services:
--   1. Adoption registration — on approval, the child's citizens.parent_citizen_id is
--      repointed to the adoptive parent, the same guardian link birth registration already
--      uses for minors (migration 003). The previous guardian is kept on record, not erased.
--   2. Issuing burial orders — authorises burial of an already-registered deceased citizen
--      (death_records, migration 020). Requires the death registration to already be Approved;
--      enforced in the controller, not the DB, so this migration stays a plain CREATE TABLE.

CREATE TABLE IF NOT EXISTS adoption_records (
    adoption_record_id         SERIAL PRIMARY KEY,
    citizen_id                    INTEGER NOT NULL REFERENCES citizens(citizen_id), -- filer = adoptive parent
    child_citizen_id                 INTEGER NOT NULL REFERENCES citizens(citizen_id),
    previous_guardian_citizen_id       INTEGER REFERENCES citizens(citizen_id),
    court_order_reference                VARCHAR(60) NOT NULL,
    court_name                             VARCHAR(120),
    adoption_date                            DATE NOT NULL,
    reason_details                             TEXT,
    registration_reference                       VARCHAR(30) NOT NULL UNIQUE,
    status                                         VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required', 'Approved', 'Rejected')),
    rejection_reason                                 TEXT,
    reviewed_by_user_id                                INTEGER REFERENCES users(user_id),
    reviewed_at                                          TIMESTAMPTZ,
    requested_at                                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adoption_citizen ON adoption_records(citizen_id);
CREATE INDEX IF NOT EXISTS idx_adoption_child ON adoption_records(child_citizen_id);

CREATE TABLE IF NOT EXISTS burial_order_requests (
    burial_order_request_id  SERIAL PRIMARY KEY,
    citizen_id                  INTEGER NOT NULL REFERENCES citizens(citizen_id), -- the filer/next of kin
    death_record_id                INTEGER NOT NULL REFERENCES death_records(death_record_id),
    place_of_burial                  VARCHAR(150) NOT NULL,
    cemetery_or_site                    VARCHAR(150),
    planned_burial_date                   DATE NOT NULL,
    order_reference                         VARCHAR(30) NOT NULL UNIQUE,
    order_number                              VARCHAR(30) UNIQUE, -- assigned on approval
    status                                      VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required', 'Approved', 'Rejected')),
    rejection_reason                              TEXT,
    reviewed_by_user_id                             INTEGER REFERENCES users(user_id),
    reviewed_at                                       TIMESTAMPTZ,
    requested_at                                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_burial_order_citizen ON burial_order_requests(citizen_id);
CREATE INDEX IF NOT EXISTS idx_burial_order_death_record ON burial_order_requests(death_record_id);
