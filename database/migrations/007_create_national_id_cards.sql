-- 007_create_national_id_cards.sql
--
-- The physical National ID card, issued later in life once the citizen becomes eligible.
-- IMPORTANT: permanent_identity_number is copied here for convenient lookups/printing, but it
-- always originates from citizens.permanent_identity_number — this table NEVER generates a new
-- identity number.

CREATE TABLE IF NOT EXISTS national_id_cards (
    national_id_card_id       SERIAL PRIMARY KEY,
    citizen_id                 INTEGER NOT NULL REFERENCES citizens(citizen_id),
    permanent_identity_number  VARCHAR(20) NOT NULL REFERENCES citizens(permanent_identity_number),
    card_number                VARCHAR(30) UNIQUE, -- assigned on approval/production, NULL while in progress
    application_date            DATE NOT NULL,
    approval_date               DATE,
    production_status           VARCHAR(30) NOT NULL DEFAULT 'Application Submitted'
        CHECK (production_status IN (
            'Application Submitted', 'Under Review', 'Information Required', 'Verification in Progress',
            'Approved', 'Rejected', 'Card Production', 'Ready for Collection', 'Collected'
        )),
    rejection_reason            TEXT,
    collection_office_id        INTEGER,
    ready_for_collection_at      TIMESTAMPTZ,
    collected_at                 TIMESTAMPTZ,
    photo_reference              VARCHAR(255), -- simulated capture reference
    biometric_status              VARCHAR(20) NOT NULL DEFAULT 'Not Enrolled'
        CHECK (biometric_status IN ('Not Enrolled', 'Enrolled')),
    is_demo_data                  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_national_id_card_number ON national_id_cards(card_number);
CREATE INDEX IF NOT EXISTS idx_national_id_citizen ON national_id_cards(citizen_id);
CREATE INDEX IF NOT EXISTS idx_national_id_permanent_number ON national_id_cards(permanent_identity_number);
