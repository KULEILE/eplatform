-- 021_create_application_status_history.sql
-- Powers the "status timeline" UI (what happened, what's happening, what's next) — a direct
-- response to the "keep checking" visibility problem documented in the source research.

CREATE TABLE IF NOT EXISTS application_status_history (
    history_id        SERIAL PRIMARY KEY,
    application_id       INTEGER NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    status                 VARCHAR(40) NOT NULL,
    changed_by_user_id        INTEGER REFERENCES users(user_id), -- NULL for the initial system-generated entry
    note                        TEXT,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_status_history_app ON application_status_history(application_id);
