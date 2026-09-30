-- 002_create_departments.sql
-- The six government departments the system connects. Passport Services is its own department
-- record but is grouped under Home Affairs in the UI (see frontend department config).

CREATE TABLE IF NOT EXISTS departments (
    department_id   SERIAL PRIMARY KEY,
    department_key  VARCHAR(40) NOT NULL UNIQUE,  -- 'home_affairs' | 'traffic' | 'finance' | 'pensions' | 'police' | 'passport'
    name            VARCHAR(120) NOT NULL,
    description     TEXT,
    grouped_under   VARCHAR(40) REFERENCES departments(department_key), -- e.g. passport grouped_under 'home_affairs'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- department_key is its own natural key so grouped_under can self-reference before ids are known
INSERT INTO departments (department_key, name, description, grouped_under) VALUES
    ('home_affairs', 'Home Affairs', 'Civil registration, national identity and passport services', NULL)
ON CONFLICT (department_key) DO NOTHING;

INSERT INTO departments (department_key, name, description, grouped_under) VALUES
    ('traffic',   'Traffic',            'Driving licence and vehicle registration services', NULL),
    ('finance',   'Finance',            'Financial services requiring verified citizen identity', NULL),
    ('pensions',  'Pensions',           'Pension beneficiary verification and services', NULL),
    ('police',    'Police',             'Controlled, audited identity verification for policing', NULL),
    ('passport',  'Passport Services',  'Passport application, verification and issuance', 'home_affairs')
ON CONFLICT (department_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_departments_grouped_under ON departments(grouped_under);
