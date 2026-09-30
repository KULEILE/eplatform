-- 004_create_users.sql
--
-- Login/portal identity, kept separate from civil identity (citizens table). A citizen's
-- portal account links to a citizen record (citizen_id). An account can exist before a
-- verified citizen record does (provisional account, citizen_id NULL, is_provisional TRUE).
-- Employees generally have no citizen_id.

CREATE TABLE IF NOT EXISTS users (
    user_id            SERIAL PRIMARY KEY,
    citizen_id          INTEGER REFERENCES citizens(citizen_id),
    email               VARCHAR(160) NOT NULL UNIQUE,
    phone               VARCHAR(30),
    password_hash       VARCHAR(255) NOT NULL,
    role_id             INTEGER NOT NULL REFERENCES roles(role_id),
    department_id       INTEGER REFERENCES departments(department_id), -- set for employee roles
    account_status      VARCHAR(20) NOT NULL DEFAULT 'Active'
                            CHECK (account_status IN ('Active', 'Suspended', 'Deactivated')),
    is_provisional      BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = registered but identity not yet verified
    preferred_language  VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'st')),
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_citizen_id ON users(citizen_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
