-- 031_create_marriage_records.sql
-- Marriage registration. Lesotho law recognises both Civil and Customary marriages, both of
-- which Home Affairs registers. The filer is always an already-verified citizen (their identity
-- comes from the citizens table, the same "verified identity is the source of truth" pattern
-- birth registration uses for the parent); the other spouse is recorded as supplied — they may
-- or may not have an account in this system, exactly like a birth registration's parents.

CREATE TABLE IF NOT EXISTS marriage_records (
    marriage_record_id     SERIAL PRIMARY KEY,
    filer_citizen_id          INTEGER NOT NULL REFERENCES citizens(citizen_id),
    registration_reference       VARCHAR(30) NOT NULL UNIQUE,

    spouse2_name                    VARCHAR(150) NOT NULL,
    spouse2_date_of_birth              DATE,
    spouse2_nationality                   VARCHAR(60) DEFAULT 'Mosotho',
    spouse2_permanent_identity_number        VARCHAR(20),

    marriage_type                               VARCHAR(20) NOT NULL CHECK (marriage_type IN ('Civil', 'Customary')),
    marriage_date                                  DATE NOT NULL,
    place_of_marriage                                 VARCHAR(150) NOT NULL,
    witness1_name                                        VARCHAR(150) NOT NULL,
    witness2_name                                           VARCHAR(150) NOT NULL,
    officiant_name                                             VARCHAR(150),

    preferred_office_id                                           INTEGER REFERENCES offices(office_id),
    status                                                            VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required',
                           'Verified', 'Approved', 'Rejected')),
    certificate_number                                                   VARCHAR(30) UNIQUE,
    rejection_reason                                                        TEXT,
    submitted_at                                                               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at                                                                   TIMESTAMPTZ,
    created_at                                                                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                                                         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marriage_records_filer ON marriage_records(filer_citizen_id);
CREATE INDEX IF NOT EXISTS idx_marriage_records_status ON marriage_records(status);
