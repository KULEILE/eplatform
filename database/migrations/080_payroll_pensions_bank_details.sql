-- 080_payroll_pensions_bank_details.sql
--
-- "this system is still on the prototype system please improve this system in to real system
-- it must show all employee and those who are still alive and those who are dead and finance
-- department should pay this employee and pension department should pay eligible citizens and
-- it must show totals of citizen how earning pensions also the citizen must be able to provide
-- their bank details and correct them later if thy change banks so when citizen have issues
-- must select sub finance eg. health, education ... the system must automatically mark officers
-- as government employees ... the citizen must not allowed to submit many claim unless other
-- one is rejected."
--
-- Five additive pieces, each explained where it's added below. Nothing here changes any
-- existing table's existing meaning or any existing row — citizens.government_employment_status,
-- finance_records, pension_records all keep their current behaviour; this only adds new
-- columns/tables alongside them.

-- ============================================================================================
-- 1. BANK DETAILS — a citizen's own account for receiving salary/pension, submitted and
--    reviewed through the EXISTING "Payment Information Update" request (finance_records),
--    never a separate unreviewed self-service form — consistent with this system's "an officer
--    reviews every official record change" pattern. This deliberately reverses the
--    "non-sensitive summary only, never raw account data" comment on validated_information_note
--    (migration 010) — a conscious decision, confirmed with the citizen who requested this
--    feature after that reversal was pointed out to them.
--
--    The columns on finance_records hold what the CITIZEN SUBMITTED in a given application; the
--    columns on citizens hold what is actually on file for payment once an officer has approved
--    that application (see finance.controller.js's 'complete' transition for Payment
--    Information Update, which copies one onto the other).
-- ============================================================================================

ALTER TABLE finance_records
    ADD COLUMN IF NOT EXISTS bank_name VARCHAR(120),
    ADD COLUMN IF NOT EXISTS bank_account_holder_name VARCHAR(160),
    ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(40),
    ADD COLUMN IF NOT EXISTS bank_branch_name VARCHAR(120);

ALTER TABLE citizens
    ADD COLUMN IF NOT EXISTS bank_name VARCHAR(120),
    ADD COLUMN IF NOT EXISTS bank_account_holder_name VARCHAR(160),
    ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(40),
    ADD COLUMN IF NOT EXISTS bank_branch_name VARCHAR(120),
    ADD COLUMN IF NOT EXISTS bank_details_updated_at TIMESTAMPTZ;

-- ============================================================================================
-- 2. ISSUE-TYPE CATEGORIES ("sub finance eg. health, education") — this system's six
--    departments are fixed (see departments table; "health"/"education" are not among them), so
--    this is a category field on top of Finance's own existing complaint mechanism (service
--    type 'Finance Complaint or Enquiry'), not a new department. financial_issues (migration
--    078) already has a cross-department picker for the OTHER, separate "Report a Financial
--    Issue" flow — this is additive to Finance's own complaint form only.
-- ============================================================================================

ALTER TABLE finance_records
    ADD COLUMN IF NOT EXISTS issue_category VARCHAR(30)
        CHECK (issue_category IN ('Salary Issue', 'Bank Details Issue', 'Pension Issue', 'Supplier Payment Issue', 'Tax Issue', 'Other'));

-- ============================================================================================
-- 3. PAYROLL — Finance (simulated) pays its employees. monthly_salary lives on citizens (the
--    same table government_employment_status already lives on) because paying anyone requires
--    first knowing who they really are — an employee account with no linked citizen identity
--    (see point 5 below) cannot yet be paid, by design. salary_payments is a real ledger of
--    individual (simulated) payment events — not a boolean flag — so a totals report has real
--    numbers to sum and a payment history to show. This is its own table, rather than reusing
--    finance_records' existing 'Paid' status (Government Supplier Payment Tracking, migration
--    056), because an employee is paid repeatedly (every month), not once per invoice; the
--    UNIQUE constraint below prevents the same employee being paid twice for the same month.
-- ============================================================================================

ALTER TABLE citizens
    ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(12,2) CHECK (monthly_salary IS NULL OR monthly_salary >= 0);

CREATE TABLE IF NOT EXISTS salary_payments (
    salary_payment_id  SERIAL PRIMARY KEY,
    citizen_id          INTEGER NOT NULL REFERENCES citizens(citizen_id),
    pay_period           VARCHAR(7) NOT NULL, -- 'YYYY-MM'
    amount                NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reference              VARCHAR(40),
    paid_by_user_id           INTEGER NOT NULL REFERENCES users(user_id),
    paid_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_demo_data                 BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (citizen_id, pay_period)
);
CREATE INDEX IF NOT EXISTS idx_salary_payments_citizen ON salary_payments(citizen_id);

-- ============================================================================================
-- 4. PENSION DISBURSEMENT + TOTALS — same reasoning as payroll above, for Pensions.
--    monthly_amount lives on the specific pension_records claim (not on citizens) because a
--    citizen holds at most one approved pension claim at a time (pensions.controller.js already
--    enforces this), and the entitlement amount is naturally a property of THAT claim/decision,
--    set by a pensions officer when they approve it — not a second, separate citizen-level
--    figure that could drift out of sync with which claim is actually active.
-- ============================================================================================

ALTER TABLE pension_records
    ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(12,2) CHECK (monthly_amount IS NULL OR monthly_amount >= 0);

CREATE TABLE IF NOT EXISTS pension_payments (
    pension_payment_id  SERIAL PRIMARY KEY,
    pension_record_id     INTEGER NOT NULL REFERENCES pension_records(pension_record_id),
    citizen_id              INTEGER NOT NULL REFERENCES citizens(citizen_id),
    pay_period                VARCHAR(7) NOT NULL,
    amount                      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reference                    VARCHAR(40),
    paid_by_user_id                 INTEGER NOT NULL REFERENCES users(user_id),
    paid_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_demo_data                        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (pension_record_id, pay_period)
);
CREATE INDEX IF NOT EXISTS idx_pension_payments_record ON pension_payments(pension_record_id);
CREATE INDEX IF NOT EXISTS idx_pension_payments_citizen ON pension_payments(citizen_id);

-- ============================================================================================
-- 5. OFFICER-AS-EMPLOYEE LINKING — "the system must automatically mark officers as government
--    employees". users.citizen_id (migration 004) already exists but is NULL by default for
--    every officer/admin account (see seed.js) — this is what actually blocks the request:
--    employment status lives on citizens, not users, and most officer accounts today have no
--    citizen row to set it on at all. No schema change is needed here beyond an index — the
--    real fix is in admin.controller.js: (a) account creation gets an optional citizen-link
--    field, (b) a new retroactive "link citizen record" action for existing accounts, both of
--    which, the moment citizen_id is set, automatically set that citizen's
--    government_employment_status = 'Active' (never downgrading an already-'Retired' employee).
-- ============================================================================================

CREATE INDEX IF NOT EXISTS idx_users_citizen_id_lookup ON users(citizen_id) WHERE citizen_id IS NOT NULL;
