-- 034_add_biometric_reference.sql
--
-- Replaces the fake "biometric_status flips to Enrolled when the card enters production" logic
-- with a real captured reference. Previously biometric_status was set to 'Enrolled' purely as a
-- side effect of an officer clicking "Start card production" (see transitionNationalId in
-- homeAffairs.controller.js) — no biometric data was ever actually taken from the citizen.
--
-- From this migration on: biometric_reference is captured (as an uploaded image reference, same
-- convention as photo_reference — see upload.js/uploads.controller.js's uploadBiometric) at
-- application time, and biometric_status is only ever 'Enrolled' when that reference exists.

ALTER TABLE national_id_cards
    ADD COLUMN IF NOT EXISTS biometric_reference VARCHAR(255);
