-- 041_create_solemnisation_and_foreign_id.sql
--
-- Two new Home Affairs services:
--   1. Civil marriage solemnisation — booking an officiant and a branch for the ceremony
--      itself, as opposed to registering a marriage that already happened. A different shape
--      of feature: it's a calendar booking (Requested -> Confirmed -> Completed/Cancelled),
--      not a document approval, though it reuses the same review fields for consistency.
--   2. Identity enrolment for non-citizens/refugees — a parallel track to National ID
--      enrolment (migration 007) for people who are not in the citizens table at all. Keyed
--      off the logged-in user's account (users.user_id), not a citizens row, since by
--      definition this applicant has none yet. Approval assigns a foreign_id_number using a
--      distinct 'F'-prefixed scheme so it can never collide with permanent_identity_number.

CREATE TABLE IF NOT EXISTS marriage_solemnisation_bookings (
    booking_id                   SERIAL PRIMARY KEY,
    citizen_id                      INTEGER NOT NULL REFERENCES citizens(citizen_id), -- the filer
    spouse1_name                       VARCHAR(150) NOT NULL,
    spouse2_name                          VARCHAR(150) NOT NULL,
    office_id                                INTEGER NOT NULL REFERENCES offices(office_id),
    requested_date                             DATE NOT NULL,
    requested_time                               TIME,
    marriage_officer_registration_id               INTEGER REFERENCES marriage_officer_registrations(marriage_officer_registration_id),
    confirmed_date                                   DATE,
    confirmed_time                                     TIME,
    booking_reference                                    VARCHAR(30) NOT NULL UNIQUE,
    status                                                 VARCHAR(30) NOT NULL DEFAULT 'Requested'
        CHECK (status IN ('Requested', 'Additional Information Required', 'Confirmed', 'Completed', 'Cancelled', 'Rejected')),
    rejection_reason                                         TEXT,
    reviewed_by_user_id                                        INTEGER REFERENCES users(user_id),
    reviewed_at                                                  TIMESTAMPTZ,
    requested_at                                                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_solemnisation_citizen ON marriage_solemnisation_bookings(citizen_id);
CREATE INDEX IF NOT EXISTS idx_solemnisation_office ON marriage_solemnisation_bookings(office_id);

CREATE TABLE IF NOT EXISTS foreign_identity_enrolments (
    foreign_identity_enrolment_id  SERIAL PRIMARY KEY,
    applicant_user_id                 INTEGER NOT NULL REFERENCES users(user_id),
    full_name                            VARCHAR(150) NOT NULL,
    date_of_birth                           DATE NOT NULL,
    sex                                        VARCHAR(20) NOT NULL CHECK (sex IN ('Male', 'Female', 'Other', 'Unspecified')),
    nationality                                 VARCHAR(80) NOT NULL,
    travel_document_type                          VARCHAR(30) NOT NULL CHECK (travel_document_type IN ('Passport', 'Refugee Travel Document', 'Other')),
    travel_document_number                          VARCHAR(40) NOT NULL,
    immigration_status                                VARCHAR(40) NOT NULL
        CHECK (immigration_status IN ('Refugee', 'Asylum Seeker', 'Work Permit Holder', 'Study Permit Holder', 'Permanent Resident', 'Other')),
    photo_reference                                     VARCHAR(255),
    biometric_reference_left                              VARCHAR(255),
    biometric_reference_right                               VARCHAR(255),
    enrolment_reference                                        VARCHAR(30) NOT NULL UNIQUE,
    foreign_id_number                                            VARCHAR(30) UNIQUE, -- assigned on approval, e.g. 'F20260912000483'
    status                                                         VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required', 'Approved', 'Rejected')),
    rejection_reason                                                 TEXT,
    reviewed_by_user_id                                                INTEGER REFERENCES users(user_id),
    reviewed_at                                                          TIMESTAMPTZ,
    requested_at                                                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                                              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_foreign_id_applicant ON foreign_identity_enrolments(applicant_user_id);
