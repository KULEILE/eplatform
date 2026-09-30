-- 030_add_info_required_to_police_clearance.sql
-- police_clearance_requests (migration 029) uses the generic department-service factory, whose
-- requestInformation() sets status = 'Additional Information Required' from any non-final
-- state — that value was missing from the original status CHECK constraint.

ALTER TABLE police_clearance_requests DROP CONSTRAINT IF EXISTS police_clearance_requests_status_check;
ALTER TABLE police_clearance_requests ADD CONSTRAINT police_clearance_requests_status_check
    CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required',
                       'Background Check In Progress', 'Approved', 'Rejected',
                       'Ready for Collection', 'Collected'));
