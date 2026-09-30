-- 016_create_audit_logs.sql
-- Every sensitive access — especially Police lookups, but also approvals, corrections and
-- admin changes — is recorded here. This table is append-only from the application's
-- perspective (no UPDATE/DELETE routes are exposed for it).

CREATE TABLE IF NOT EXISTS audit_logs (
    audit_log_id     SERIAL PRIMARY KEY,
    user_id             INTEGER REFERENCES users(user_id),
    department_id        INTEGER REFERENCES departments(department_id),
    action                 VARCHAR(80) NOT NULL, -- e.g. 'POLICE_IDENTITY_LOOKUP', 'BIRTH_REGISTRATION_APPROVED'
    target_type             VARCHAR(60) NOT NULL, -- e.g. 'citizen', 'birth_record', 'system_settings'
    target_id                 INTEGER,
    reason                     TEXT, -- required for sensitive lookups (e.g. police purpose)
    metadata                    JSONB, -- flexible extra context (ip, before/after values, etc.)
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_department ON audit_logs(department_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
