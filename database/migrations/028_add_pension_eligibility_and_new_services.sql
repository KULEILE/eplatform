-- 028_add_pension_eligibility_and_new_services.sql
-- Adds the "Pension Age Eligibility Claim" service type to Pensions. Eligibility itself is
-- never re-entered by the citizen — it's checked server-side against the date_of_birth
-- already verified by Home Affairs on the citizens table, the same "verified identity is the
-- source of truth" principle the rest of this system already follows (see the identity
-- verification mismatch handling). No new column is needed for that.

ALTER TABLE pension_records DROP CONSTRAINT IF EXISTS pension_records_service_type_check;
ALTER TABLE pension_records ADD CONSTRAINT pension_records_service_type_check
    CHECK (service_type IN (
        'New Pension Enrolment', 'Proof of Life Verification', 'Beneficiary Correction',
        'Pension Status Enquiry', 'Pension Age Eligibility Claim'
    ));
