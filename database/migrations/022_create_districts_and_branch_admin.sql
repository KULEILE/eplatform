-- 022_create_districts_and_branch_admin.sql
--
-- Lesotho is organised into ten districts. Government offices ("branches") sit within a
-- district and belong to one department. Citizens choose a branch when they apply for a
-- document so they know, from the moment they apply, exactly where they will collect it.
--
-- This migration also introduces a devolved account-creation model:
--   - System Administrator (head office, platform-wide) appoints Branch Administrators.
--   - A Branch Administrator creates the employee (officer) accounts for their own branch,
--     issuing a temporary password that must be changed at first login.

CREATE TABLE IF NOT EXISTS districts (
    district_id   SERIAL PRIMARY KEY,
    name          VARCHAR(60) NOT NULL UNIQUE,
    code          VARCHAR(10) NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO districts (name, code) VALUES
    ('Maseru',         'MSU'),
    ('Berea',          'BER'),
    ('Leribe',         'LRB'),
    ('Butha-Buthe',    'BB'),
    ('Mokhotlong',     'MKL'),
    ('Thaba-Tseka',    'TTK'),
    ('Qacha''s Nek',   'QN'),
    ('Quthing',        'QTG'),
    ('Mohale''s Hoek', 'MHK'),
    ('Mafeteng',       'MFT')
ON CONFLICT (name) DO NOTHING;

-- Offices ("branches") upgrade: proper district reference instead of free text, plus a
-- short branch code and a head-office flag (nullable/optional so this stays safe to run
-- against a database that may already have office rows from an earlier migration set).
ALTER TABLE offices ADD COLUMN IF NOT EXISTS district_id INTEGER REFERENCES districts(district_id);
ALTER TABLE offices ADD COLUMN IF NOT EXISTS office_code VARCHAR(20) UNIQUE;
ALTER TABLE offices ADD COLUMN IF NOT EXISTS is_head_office BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE offices DROP COLUMN IF EXISTS district;

CREATE INDEX IF NOT EXISTS idx_offices_district ON offices(district_id);
CREATE INDEX IF NOT EXISTS idx_offices_department ON offices(department_id);

-- New role: Branch Administrator. Appointed by a System Administrator; creates and manages
-- employee accounts for one specific branch office.
INSERT INTO roles (role_key, display_name, description) VALUES
    ('branch_admin', 'Branch Administrator', 'Appointed by a System Administrator to create and manage employee accounts for one branch office')
ON CONFLICT (role_key) DO NOTHING;

-- Users: branch assignment + forced first-login password change + who appointed this account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS office_id INTEGER REFERENCES offices(office_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS appointed_by_user_id INTEGER REFERENCES users(user_id);

CREATE INDEX IF NOT EXISTS idx_users_office ON users(office_id);
