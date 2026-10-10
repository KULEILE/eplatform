-- 036_add_biometric_left_right.sql
--
-- A real National ID enrolment scans both hands, not a single generic "biometric" capture.
-- Splits the single biometric_reference column (034) into one reference per hand. The old
-- biometric_reference column is left in place (not dropped) so existing rows aren't disturbed,
-- but applyNationalId no longer writes to it — see homeAffairs.controller.js.

ALTER TABLE national_id_cards
    ADD COLUMN IF NOT EXISTS biometric_reference_left  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS biometric_reference_right VARCHAR(255);