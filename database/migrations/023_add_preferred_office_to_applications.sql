-- 023_add_preferred_office_to_applications.sql
--
-- The citizen picks their collection branch AT APPLICATION TIME (not left until an officer
-- assigns one later), so from the moment they apply they know where they'll collect the
-- finished document. preferred_office_id is what the citizen chose; collection_office_id
-- (already on these tables) remains the confirmed office once the document is actually ready,
-- and defaults to preferred_office_id unless an officer deliberately overrides it.

ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS preferred_office_id INTEGER REFERENCES offices(office_id);
ALTER TABLE national_id_cards ADD COLUMN IF NOT EXISTS preferred_office_id INTEGER REFERENCES offices(office_id);
ALTER TABLE passport_records ADD COLUMN IF NOT EXISTS preferred_office_id INTEGER REFERENCES offices(office_id);

CREATE INDEX IF NOT EXISTS idx_birth_records_preferred_office ON birth_records(preferred_office_id);
CREATE INDEX IF NOT EXISTS idx_national_id_preferred_office ON national_id_cards(preferred_office_id);
CREATE INDEX IF NOT EXISTS idx_passport_preferred_office ON passport_records(preferred_office_id);
