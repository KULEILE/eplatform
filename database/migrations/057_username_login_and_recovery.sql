-- 057_username_login_and_recovery.sql
--
-- Stage 2 of the Home Affairs automation plan: every citizen logs in with a username and
-- password — no email or phone required. Email and phone become fully optional, used only
-- (when present) for a citizen's own reference; they are no longer needed to log in or recover
-- an account. A citizen with neither sets two security questions at registration instead, and
-- uses them to recover a forgotten password.
--
-- 1. Add `username` to users. Every account that already exists (seeded demo accounts, officer
--    accounts created by an admin, any real citizen account already registered) gets one
--    generated automatically from their email, so nobody is locked out by this change — see the
--    UPDATE below. Going forward, every new account picks its own username at registration/
--    creation time.
-- 2. Make `email` optional (it was NOT NULL before). Phone was already optional.
-- 3. A new table, user_security_answers, stores the two security questions each account chose
--    and a HASHED answer to each (never the plain answer) — used only by the "forgot password"
--    flow in auth.controller.js.

ALTER TABLE users ADD COLUMN username VARCHAR(50);

-- Backfill: derive a username from the existing email's local part (before the @), keeping only
-- lowercase letters, numbers, underscore and period, then append the account's own user_id so it
-- is always unique even if two emails happen to reduce to the same text, or an email has no
-- usable characters at all (falls back to 'user_<id>').
UPDATE users
SET username = COALESCE(NULLIF(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_.]', '', 'g'), ''), 'user') || '_' || user_id
WHERE username IS NULL;

ALTER TABLE users ALTER COLUMN username SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE users ADD CONSTRAINT users_username_format_check CHECK (username ~ '^[a-z0-9_.]{3,50}$');

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

CREATE TABLE user_security_answers (
  answer_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_key VARCHAR(50) NOT NULL,
  answer_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, question_key)
);
CREATE INDEX idx_user_security_answers_user ON user_security_answers(user_id);
