/**
 * Citizen-facing incident/request reporting — the eight reporting services plus Police
 * Information Requests from the department's service list (migration 055), built on the same
 * generic department-service factory as Traffic/Finance/Pensions/Police Clearance
 * (simpleDepartmentController.js): a citizen applies (picking one of the nine service types),
 * tracks it via the existing cross-department "My Applications" view (populated automatically
 * by the factory's apply()), and an officer works a queue with request-information/reject/the
 * two-step review below.
 *
 * Deliberately a flat two-step review (Submitted -> Under Review -> Completed) rather than the
 * long multi-stage flows Traffic/Finance use (identity verification, document checks, etc.) —
 * these are incoming reports, not credential applications; there is nothing to issue, so there
 * is nothing to collect. An officer who decides a report needs a formal investigation opens an
 * actual case against it using the separate case-management tool (migration 054/
 * policeCase.controller.js) — that's a deliberate, manual decision an officer makes after
 * reading the report, not something this controller does automatically.
 */
const { makeDepartmentController } = require('../utils/simpleDepartmentController');

// Required, beyond the shared `description`, for the service types that need them — checked
// server-side here, not just left to the frontend form's `required` attribute (see each
// report's own apply page, which already marks these required in the UI; this is the real
// enforcement).
const REQUIRED_EXTRA_FIELDS = {
  'Lost Property Reporting': ['itemDescription'],
  'Stolen Property Reporting': ['itemDescription'],
  'Missing Person Reporting': ['missingPersonName'],
  'Traffic Accident Reporting': ['location'],
};

async function beforeApply(req) {
  const { serviceType } = req.body;
  const required = REQUIRED_EXTRA_FIELDS[serviceType] || [];
  for (const field of required) {
    if (!req.body[field] || !String(req.body[field]).trim()) {
      return { error: `${field} is required for ${serviceType}.` };
    }
  }
  return null;
}

const base = makeDepartmentController({
  table: 'police_reports',
  idColumn: 'report_id',
  deptKey: 'police',
  officerRoleKey: 'police_officer',
  refPrefix: 'PRP',
  serviceTypes: [
    'Lost Property Reporting', 'Stolen Property Reporting', 'General Crime Reporting',
    'Cybercrime Reporting', 'Missing Person Reporting', 'Domestic Violence Reporting',
    'Traffic Accident Reporting', 'Police Complaint Submission', 'Police Information Request',
  ],
  extraInsertFields: [
    { column: 'description', fromBody: 'description' },
    { column: 'incident_date', fromBody: 'incidentDate' },
    { column: 'location', fromBody: 'location' },
    { column: 'evidence_reference', fromBody: 'evidenceReference' },
    { column: 'item_description', fromBody: 'itemDescription' },
    { column: 'missing_person_name', fromBody: 'missingPersonName' },
    { column: 'missing_person_age', fromBody: 'missingPersonAge' },
    { column: 'platform_or_service', fromBody: 'platformOrService' },
    { column: 'vehicles_involved', fromBody: 'vehiclesInvolved' },
    { column: 'officer_name_or_badge', fromBody: 'officerNameOrBadge' },
    { column: 'needs_immediate_assistance', fromBody: 'needsImmediateAssistance' },
  ],
  beforeApply,
  finalStatuses: ['Rejected', 'Completed'],
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'complete': { from: 'Under Review', to: 'Completed' },
  },
});

module.exports = base;
