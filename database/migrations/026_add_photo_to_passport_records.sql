-- 026_add_photo_to_passport_records.sql
--
-- National ID applications already had a photo_reference column (see 007_create_national_id_cards.sql)
-- but it only ever held a fake "demo-photo-<timestamp>.jpg" string typed by the frontend — no real
-- image was ever captured. This adds the same column to passport_records so a real uploaded photo
-- can be attached there too (see backend/src/routes/uploads.routes.js for the upload endpoint).

ALTER TABLE passport_records ADD COLUMN IF NOT EXISTS photo_reference VARCHAR(255);
