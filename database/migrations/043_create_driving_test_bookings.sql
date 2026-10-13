-- 043_create_driving_test_bookings.sql
--
-- Driving theory test and practical driving test booking. Deliberately NOT folded into
-- traffic_records: a test booking has its own lifecycle (requested -> scheduled -> a pass/fail
-- result, or cancelled) rather than the licence-issuing pipeline, and the eligibility rules are
-- different for each test_type — enforced in traffic.controller.js, not by a DB trigger:
--   - Theory: the citizen must already hold an Approved/Collected Learner Permit.
--   - Practical: the citizen must additionally have a Passed theory test on record.
-- This is why a theory test cannot be booked before a learner permit exists, and a practical
-- test cannot be booked before the theory test is passed — the natural order of getting a
-- driving licence, not an arbitrary restriction.

CREATE TABLE IF NOT EXISTS driving_test_bookings (
    driving_test_booking_id SERIAL PRIMARY KEY,
    citizen_id               INTEGER NOT NULL REFERENCES citizens(citizen_id),
    booking_reference        VARCHAR(30) NOT NULL UNIQUE,
    test_type                VARCHAR(20) NOT NULL CHECK (test_type IN ('Theory', 'Practical')),
    requested_date            DATE NOT NULL, -- citizen's preferred date
    office_id                 INTEGER REFERENCES offices(office_id), -- preferred test centre
    confirmed_date             DATE, -- officer-assigned actual test date, once scheduled
    result                     VARCHAR(10) NOT NULL DEFAULT 'Pending'
        CHECK (result IN ('Pending', 'Passed', 'Failed')),
    status                     VARCHAR(20) NOT NULL DEFAULT 'Requested'
        CHECK (status IN ('Requested', 'Scheduled', 'Completed', 'Cancelled', 'Rejected')),
    rejection_reason            TEXT,
    is_demo_data                 BOOLEAN NOT NULL DEFAULT TRUE,
    requested_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driving_test_citizen ON driving_test_bookings(citizen_id);
CREATE INDEX IF NOT EXISTS idx_driving_test_status ON driving_test_bookings(status);
