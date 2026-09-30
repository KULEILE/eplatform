-- 027_add_accommodation_to_appointments.sql
-- The appointments table (migration 017) has existed since early in the schema but nothing
-- was ever built on top of it. We're building the interpreter-assisted appointment feature on
-- top of it now, for citizens who cannot use the digital self-service channel unassisted (for
-- example a Deaf citizen who needs a Lesotho Sign Language interpreter present).
--
-- Needing an interpreter or another accommodation isn't a new *reason* to come in — it's a
-- modifier on whatever the real reason already is (Identity Enrolment, Biometric Capture, etc.),
-- so this does not add a new `purpose` value. Instead it adds optional fields any appointment can
-- carry, so the officer preparing for the visit knows ahead of time what to arrange.

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS needs_interpreter BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS interpreter_language VARCHAR(60);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS accommodation_notes TEXT;
