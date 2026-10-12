-- 037_national_id_renewal_replacement.sql
--
-- New Home Affairs service: "National ID card renewal & replacement". Reuses the existing
-- national_id_cards table/workflow (a renewal or replacement is still, physically, a new card
-- row) instead of a parallel table, distinguished by application_type. A Replacement additionally
-- records why the old card is gone and, where known, its card number for the officer's reference.

ALTER TABLE national_id_cards
    ADD COLUMN IF NOT EXISTS application_type VARCHAR(20) NOT NULL DEFAULT 'New'
        CHECK (application_type IN ('New', 'Renewal', 'Replacement')),
    ADD COLUMN IF NOT EXISTS replacement_reason VARCHAR(20)
        CHECK (replacement_reason IN ('Lost', 'Stolen', 'Damaged', 'Expired', 'Other')),
    ADD COLUMN IF NOT EXISTS replacement_details TEXT,
    ADD COLUMN IF NOT EXISTS previous_card_number VARCHAR(30);

CREATE INDEX IF NOT EXISTS idx_national_id_application_type ON national_id_cards(application_type);
