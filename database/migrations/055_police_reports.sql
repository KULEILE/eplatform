-- 055_police_reports.sql
-- Eight citizen-facing police reporting/request services from the department's service list:
-- Lost Property Reporting, Stolen Property Reporting, General Crime Reporting, Cybercrime
-- Reporting, Missing Person Reporting, Domestic Violence Reporting, Traffic Accident Reporting,
-- Police Complaint Submission, and Police Information Requests (nine service_type values in
-- total). Built on the same generic department-service factory as Traffic/Finance/Pensions and
-- the Police Clearance Certificate (simpleDepartmentController.js), one shared table with a
-- service_type discriminator — same pattern traffic_records already uses for its thirteen
-- distinct service types, rather than nine near-identical tables.
--
-- Deliberately kept separate from police_cases/police_arrests/police_sentences (migration 054,
-- officer-initiated investigative casework) and from police_clearance_requests (migration 029,
-- the certificate application) — this table is the citizen's own incoming report, before any
-- officer has opened a formal case on it. An officer who decides a report warrants a formal
-- investigation opens a police_cases record separately (migration 054's startCase); the two are
-- not automatically linked, the same way a citizen's identity-verification lookup and the police
-- clearance certificate are two separate tools that both happen to read from the same
-- underlying citizen/case data.

CREATE TABLE IF NOT EXISTS police_reports (
    report_id               SERIAL PRIMARY KEY,
    citizen_id               INTEGER NOT NULL REFERENCES citizens(citizen_id),
    application_reference     VARCHAR(30) NOT NULL UNIQUE,
    service_type                VARCHAR(40) NOT NULL
        CHECK (service_type IN (
            'Lost Property Reporting', 'Stolen Property Reporting', 'General Crime Reporting',
            'Cybercrime Reporting', 'Missing Person Reporting', 'Domestic Violence Reporting',
            'Traffic Accident Reporting', 'Police Complaint Submission', 'Police Information Request'
        )),
    status                          VARCHAR(30) NOT NULL DEFAULT 'Submitted'
        CHECK (status IN ('Submitted', 'Under Review', 'Additional Information Required',
                           'Completed', 'Rejected')),

    -- Shared by every service type: what happened / what is being asked, required for all nine
    -- (including an Information Request, where this is simply the citizen's question).
    description                       TEXT NOT NULL,

    -- Optional, apply to most incident-reporting types but not Information Requests; left NULL
    -- when a given service type has no use for them (frontend only shows the fields relevant to
    -- the service type the citizen picked — see each report's own apply page).
    incident_date                        DATE,
    location                                VARCHAR(200),
    evidence_reference                        TEXT,  -- uploaded photo/document reference (see fileUpload)

    -- Service-type-specific fields. Nullable because each only applies to one or two of the nine
    -- service types; validated as required for the types that need them in
    -- policeReports.controller.js's beforeApply, not just the frontend form.
    item_description                            VARCHAR(200),  -- Lost/Stolen Property Reporting
    missing_person_name                            VARCHAR(160), -- Missing Person Reporting
    missing_person_age                                VARCHAR(10),  -- Missing Person Reporting (free text: exact age may be unknown)
    platform_or_service                                  VARCHAR(160), -- Cybercrime Reporting
    vehicles_involved                                       VARCHAR(200), -- Traffic Accident Reporting
    officer_name_or_badge                                      VARCHAR(160), -- Police Complaint Submission
    -- Nullable (not NOT NULL DEFAULT FALSE) deliberately: every other service type's apply()
    -- call goes through the same shared INSERT and sends this column as an explicit NULL rather
    -- than omitting it (see extraInsertFields in policeReports.controller.js), which would
    -- violate a NOT NULL constraint on every non-Domestic-Violence report. NULL is treated as
    -- "no" everywhere this is read.
    needs_immediate_assistance                                    BOOLEAN, -- Domestic Violence Reporting (triage flag)

    rejection_reason          TEXT,
    is_demo_data               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_police_reports_citizen ON police_reports(citizen_id);
CREATE INDEX IF NOT EXISTS idx_police_reports_status ON police_reports(status);
CREATE INDEX IF NOT EXISTS idx_police_reports_service_type ON police_reports(service_type);
