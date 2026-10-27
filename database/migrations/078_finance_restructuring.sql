-- 078_finance_restructuring.sql
--
-- "I think we should have one big department but divided it into two parts which are public
-- and government where individuals go to thier related financial department and that department
-- will submit all records to big one... financial should have two faces which are public one
-- for individual and that one allocate budgets and this face must seen by head branch
-- administrator where they apply and receive money" — followed by "to avoid many change let's
-- make this sub public services should have administrator that will switch choose which
-- department office they want to login and solve per department it and add employees of that
-- we must have all categories" and finally "leave it with Finance Officer" (budget approvals).
--
-- This migration builds both halves of that request:
--
-- 1. Financial issue escalation (the "public face"): a citizen raises a financial issue
--    against ANY department through one shared page. A new role, Department Finance
--    Administrator, is not tied to one office the way Branch Administrator is — it switches
--    between any department + branch office ("we must have all categories" = every department
--    is selectable, not a restricted subset) and, in whichever context it is currently switched
--    to, resolves issues raised there or escalates them to Finance when it lacks authority
--    (pure officer judgment, no fixed rule). When this same administrator switches its context
--    to Finance, that is where it sees and resolves everything other departments escalated —
--    one role on both ends of the escalation, not a second role handling the Finance side.
--    It can also manage employee accounts for whichever office it is currently switched to,
--    reusing the existing Branch Administrator account-creation logic (see admin.controller.js).
--
-- 2. Branch budget requests (the "government/budget face"): the EXISTING Branch Administrator
--    role (left completely untouched otherwise, still tied to exactly one office) applies for
--    and receives budget money for its own branch. Approval/disbursement stays with the
--    EXISTING Finance Officer role, per the explicit answer "leave it with Finance Officer" —
--    it does NOT move to the new Department Finance Administrator role. This is deliberately
--    named "branch budget requests" and kept as its own table, separate from the pre-existing
--    "Budget and Tenders" document-publishing feature (finance_publications, migration 056),
--    which is an unrelated static document library and is not touched here.
--
-- Every existing role (branch_admin, home_affairs_officer, traffic_officer, finance_officer,
-- pensions_officer, police_officer, passport_officer, system_administrator) and every existing
-- table keeps its current behaviour unchanged — this migration is purely additive.

-- New role. Deliberately NOT given a department_id/office_id at creation (unlike branch_admin)
-- because it is never fixed to one branch — see active_department_id/active_office_id below.
INSERT INTO roles (role_key, display_name, description) VALUES
    ('department_finance_admin', 'Department Finance Administrator',
     'Switches between any department''s branch offices to resolve financial issues raised there, escalates to Finance when a department lacks authority to resolve one, and manages that office''s employee accounts while switched to it')
ON CONFLICT (role_key) DO NOTHING;

-- Which department + branch office a Department Finance Administrator is CURRENTLY switched
-- to. Deliberately separate from users.department_id/office_id (which stay NULL for this role)
-- because those columns mean "the one branch this account is permanently tied to" for every
-- other role (branch_admin, every *_officer) and must keep meaning exactly that — this role's
-- context changes at will, so it needed its own columns rather than repurposing those.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_department_id INTEGER REFERENCES departments(department_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_office_id INTEGER REFERENCES offices(office_id);

-- A citizen's financial issue, raised against whichever department they picked on the shared
-- "Report a Financial Issue" page. department_id records where it was originally raised;
-- current_department_id is where it currently sits for action and moves to Finance on
-- escalation — a Department Finance Administrator's queue, in whatever context it is switched
-- to, is simply "WHERE current_department_id = <that context's department>". That one column
-- is what unifies both ends of the escalation flow under a single role, as settled in
-- conversation, instead of also routing escalated issues to the existing finance_officer role.
CREATE TABLE IF NOT EXISTS financial_issues (
    financial_issue_id   SERIAL PRIMARY KEY,
    reference             VARCHAR(30) NOT NULL UNIQUE,
    citizen_id             INTEGER NOT NULL REFERENCES citizens(citizen_id),
    department_id           INTEGER NOT NULL REFERENCES departments(department_id),
    current_department_id   INTEGER NOT NULL REFERENCES departments(department_id),
    subject                   VARCHAR(160) NOT NULL,
    description                TEXT NOT NULL,
    status                      VARCHAR(20) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Resolved')),
    escalated                     BOOLEAN NOT NULL DEFAULT FALSE,
    escalated_by_user_id            INTEGER REFERENCES users(user_id),
    escalated_at                      TIMESTAMPTZ,
    escalation_note                    TEXT,
    resolved_by_user_id                  INTEGER REFERENCES users(user_id),
    resolved_at                            TIMESTAMPTZ,
    resolution_notes                        TEXT,
    is_demo_data                              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_financial_issues_citizen ON financial_issues(citizen_id);
CREATE INDEX IF NOT EXISTS idx_financial_issues_current_dept ON financial_issues(current_department_id, status);

-- A Branch Administrator's request for budget money for its own branch office. Reviewed,
-- approved/rejected and disbursed by the existing finance_officer role (and
-- system_administrator) — never by branch_admin itself, and never by department_finance_admin.
-- Simulated status trail only, consistent with how the rest of this prototype simulates process
-- (no real payment integration).
CREATE TABLE IF NOT EXISTS branch_budget_requests (
    budget_request_id    SERIAL PRIMARY KEY,
    reference              VARCHAR(30) NOT NULL UNIQUE,
    office_id                INTEGER NOT NULL REFERENCES offices(office_id),
    requested_by_user_id       INTEGER NOT NULL REFERENCES users(user_id),
    amount                        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    purpose                         VARCHAR(200) NOT NULL,
    justification                     TEXT,
    fiscal_year                         VARCHAR(9) NOT NULL,
    status                                 VARCHAR(20) NOT NULL DEFAULT 'Requested'
        CHECK (status IN ('Requested', 'Under Review', 'Approved', 'Rejected', 'Disbursed')),
    reviewed_by_user_id                       INTEGER REFERENCES users(user_id),
    review_note                                 TEXT,
    reviewed_at                                   TIMESTAMPTZ,
    disbursed_by_user_id                            INTEGER REFERENCES users(user_id),
    disbursed_at                                      TIMESTAMPTZ,
    is_demo_data                                        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                                              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_branch_budget_requests_office ON branch_budget_requests(office_id);
CREATE INDEX IF NOT EXISTS idx_branch_budget_requests_status ON branch_budget_requests(status);
