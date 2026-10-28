const db = require('../config/db');

/**
 * Enforces the rule the citizen asked for across Finance and Pensions: "the citizen must not
 * allowed to submit many claim unless other one is rejected." Two different real-world shapes
 * need two different rules, decided per service type by the caller (see FINANCE_DUPLICATE_RULES
 * in finance.controller.js and PENSION_DUPLICATE_RULES in pensions.controller.js):
 *
 *   - mode 'claim': a one-time event (retiring, enrolling in a pension, an age/civil-service
 *     pension eligibility claim). Once submitted, no second one of the SAME type is ever allowed
 *     again UNLESS the existing one was rejected — a second retirement declaration or a second
 *     pension enrolment makes no sense even after the first one has already succeeded.
 *
 *   - mode 'recurring': an ongoing service the citizen may legitimately need again later
 *     (updating bank details when they change banks, raising a new complaint about something
 *     else, a routine proof-of-life check, a correction, a status enquiry). Blocked only while
 *     an existing one of the same type is still open; once it's resolved — Rejected, or
 *     Completed/Paid/whatever this department's own finalStatuses call "done" — a brand new one
 *     can always be submitted. This is the one that makes "update your bank details again when
 *     you switch banks" still possible.
 */
async function checkDuplicateSubmission({ table, citizenId, serviceType, mode, finalStatuses }) {
  if (mode === 'claim') {
    const { rows } = await db.query(
      `SELECT 1 FROM ${table} WHERE citizen_id = $1 AND service_type = $2 AND status != 'Rejected' LIMIT 1`,
      [citizenId, serviceType]
    );
    if (rows.length > 0) {
      return `You already have a '${serviceType}' on record that was not rejected. A new one can only be submitted if the existing one is rejected.`;
    }
    return null;
  }

  // mode === 'recurring' — block only while an existing one of this type has not yet reached a
  // final status for this department (finalStatuses is passed in, since Finance and Pensions
  // each define their own — see makeDepartmentController's own finalStatuses option).
  const { rows } = await db.query(
    `SELECT 1 FROM ${table} WHERE citizen_id = $1 AND service_type = $2 AND status != ALL($3::text[]) LIMIT 1`,
    [citizenId, serviceType, finalStatuses]
  );
  if (rows.length > 0) {
    return `You already have a '${serviceType}' request that is still open. Please wait for it to be resolved before submitting another.`;
  }
  return null;
}

module.exports = { checkDuplicateSubmission };
