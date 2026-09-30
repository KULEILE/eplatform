-- 025_add_birth_certificate_official_fields.sql
--
-- The real Kingdom of Lesotho birth certificate records the father, mother and informant —
-- fields birth_records never had a place for. Added here as nullable so existing rows (demo
-- data, and any certificate already issued before this migration) keep working; the
-- certificate view shows "Not recorded" for a field left blank on an older record.

ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_name VARCHAR(160);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS father_nationality VARCHAR(60) DEFAULT 'Mosotho';
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_name VARCHAR(160);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_maiden_surname VARCHAR(80);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_nationality VARCHAR(60) DEFAULT 'Mosotho';
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS mother_residence VARCHAR(160);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS informant_name VARCHAR(160);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS informant_capacity VARCHAR(60);
ALTER TABLE birth_records ADD COLUMN IF NOT EXISTS informant_residence VARCHAR(160);
