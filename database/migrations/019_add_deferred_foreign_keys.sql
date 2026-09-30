-- 019_add_deferred_foreign_keys.sql
-- These FKs reference users(user_id), so they're added after the users table exists.

ALTER TABLE birth_records
    ADD CONSTRAINT fk_birth_records_officer FOREIGN KEY (handling_officer_id) REFERENCES users(user_id);

ALTER TABLE police_records
    ADD CONSTRAINT fk_police_records_officer FOREIGN KEY (officer_user_id) REFERENCES users(user_id);

CREATE INDEX IF NOT EXISTS idx_birth_records_officer ON birth_records(handling_officer_id);
