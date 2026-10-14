-- 048_government_employment_and_pension_eligibility.sql
--
-- Government employment status, owned by Finance (the department that funds/pays every other
-- department, i.e. the closest thing this prototype has to a public service payroll authority) —
-- never self-declared by the citizen, the same way is_deceased/date_of_birth are Home-Affairs-
-- owned facts nobody can self-edit. Citizens never type this in; a Finance officer sets it when
-- someone is hired, and it only moves to 'Retired' when a Finance officer approves a retirement
-- declaration (see finance_records below).
--
-- employee_category distinguishes the standard retirement age: ordinary civil servants retire at
-- 60, while disciplined/uniformed services (police, soldiers, correctional service officers)
-- retire at 55, reflecting the physical demands of that work.
--
-- retirement_reason is deliberately an open, extensible category list (not a fixed number per
-- reason) — "Standard" retirement is gated by the category's standard age; any other reason
-- (ill-health, medical boarding, compulsory retirement, redundancy...) waives the age check
-- entirely, because an officer has already reviewed documented grounds for retiring early and
-- that approval is the real gate, not a number this system would otherwise have to guess at.
-- retirement_reason_details is free text, used for 'Other' — never health/diagnosis detail; the
-- supporting document itself is just an opaque upload, never parsed for content.

ALTER TABLE citizens
    ADD COLUMN IF NOT EXISTS government_employment_status VARCHAR(20) NOT NULL DEFAULT 'Not Applicable'
        CHECK (government_employment_status IN ('Not Applicable', 'Active', 'Retired')),
    ADD COLUMN IF NOT EXISTS employee_category VARCHAR(40)
        CHECK (employee_category IN ('General Civil Servant', 'Uniformed/Disciplined Services')),
    ADD COLUMN IF NOT EXISTS retirement_reason VARCHAR(30)
        CHECK (retirement_reason IN ('Standard', 'Ill-health', 'Medical Boarding', 'Compulsory Retirement', 'Redundancy', 'Other')),
    ADD COLUMN IF NOT EXISTS retirement_reason_details TEXT;

CREATE INDEX IF NOT EXISTS idx_citizens_government_employment_status ON citizens(government_employment_status);

-- New Finance service: a citizen's own retirement declaration (letter/certificate attached),
-- which only takes effect on Finance officer approval — see afterTransition in
-- finance.controller.js. Reuses finance_records/the standard review pipeline rather than a
-- parallel table.
ALTER TABLE finance_records DROP CONSTRAINT IF EXISTS finance_records_service_type_check;
ALTER TABLE finance_records ADD CONSTRAINT finance_records_service_type_check
    CHECK (service_type IN (
        'Supplier Registration Validation', 'Payment Information Update',
        'Tax Identity Confirmation', 'Financial Records Correction',
        'Government Employee Retirement Declaration'
    ));

ALTER TABLE finance_records
    ADD COLUMN IF NOT EXISTS retirement_reason VARCHAR(30)
        CHECK (retirement_reason IN ('Standard', 'Ill-health', 'Medical Boarding', 'Compulsory Retirement', 'Redundancy', 'Other')),
    ADD COLUMN IF NOT EXISTS retirement_reason_details TEXT,
    ADD COLUMN IF NOT EXISTS retirement_document_reference VARCHAR(255);

-- New Pensions service: the Civil Service Pension (distinct from the universal Old Age Pension —
-- see migration 028). Gated on government_employment_status = 'Retired', not age 70 — see the
-- eligibility logic in pensions.controller.js.
ALTER TABLE pension_records DROP CONSTRAINT IF EXISTS pension_records_service_type_check;
ALTER TABLE pension_records ADD CONSTRAINT pension_records_service_type_check
    CHECK (service_type IN (
        'New Pension Enrolment', 'Proof of Life Verification', 'Beneficiary Correction',
        'Pension Status Enquiry', 'Pension Age Eligibility Claim', 'Civil Service Pension Claim'
    ));

-- A pension that must stop because Home Affairs has an approved death record for the
-- beneficiary — distinct from 'Completed' (which means the claim succeeded and is ongoing) and
-- from 'Rejected' (which means it never took effect). See approveDeath in
-- homeAffairs.controller.js, which transitions any of a deceased citizen's pension records here
-- automatically rather than only notifying an officer to do it manually.
ALTER TABLE pension_records DROP CONSTRAINT IF EXISTS pension_records_status_check;
ALTER TABLE pension_records ADD CONSTRAINT pension_records_status_check
    CHECK (status IN (
        'Draft', 'Submitted', 'Under Review', 'Identity Verified',
        'Processing', 'Additional Information Required', 'Approved', 'Rejected',
        'Flagged for Correction', 'Completed', 'Stopped (Deceased)'
    ));
