-- 001_create_roles.sql
-- Roles available across the platform. Role drives what an authenticated user can see and do.

CREATE TABLE IF NOT EXISTS roles (
    role_id        SERIAL PRIMARY KEY,
    role_key       VARCHAR(40) NOT NULL UNIQUE,   -- machine key, e.g. 'citizen', 'home_affairs_officer'
    display_name   VARCHAR(100) NOT NULL,
    description    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO roles (role_key, display_name, description) VALUES
    ('citizen',                'Citizen',                    'Ordinary member of the public using government services'),
    ('home_affairs_officer',   'Home Affairs Officer',       'Processes identity, civil registration and passport services'),
    ('traffic_officer',        'Traffic Officer',            'Processes driving licence and vehicle services'),
    ('finance_officer',        'Finance Officer',            'Processes financial services requiring identity verification'),
    ('pensions_officer',       'Pensions Officer',           'Processes pension beneficiary services'),
    ('police_officer',         'Police Officer',             'Performs controlled, audited identity verification'),
    ('passport_officer',       'Passport Officer',           'Processes passport applications'),
    ('system_administrator',   'System Administrator',       'Configures the platform, users, roles and branding')
ON CONFLICT (role_key) DO NOTHING;
