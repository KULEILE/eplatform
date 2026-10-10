-- 035_add_signature_reference.sql
--
-- Citizen's signature captured at collection (Feature 3) — the officer hands the citizen a
-- signature pad on their device when the document/card is handed over, and the resulting image
-- is stored the same way a photo/receipt/biometric capture already is. Added to every real
-- physical-collection point in the system: National ID, birth certificate, passport, and police
-- clearance certificate.

ALTER TABLE national_id_cards
    ADD COLUMN IF NOT EXISTS signature_reference VARCHAR(255);

ALTER TABLE birth_certificates
    ADD COLUMN IF NOT EXISTS signature_reference VARCHAR(255);

ALTER TABLE passport_records
    ADD COLUMN IF NOT EXISTS signature_reference VARCHAR(255);

ALTER TABLE police_clearance_requests
    ADD COLUMN IF NOT EXISTS signature_reference VARCHAR(255);