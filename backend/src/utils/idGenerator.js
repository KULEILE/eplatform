/**
 * Generates the PERMANENT IDENTITY NUMBER — created exactly once per person, at the moment
 * Home Affairs establishes their identity record (birth registration approval, or manual
 * enrolment for an adult who was never registered digitally). It is never regenerated: every
 * later document (National ID card, passport, traffic/finance/pension/police records) must
 * reuse the value already stored on citizens.permanent_identity_number.
 *
 * Format: YYYYMMDD (date of birth) + 6-digit random sequence, e.g. "19880314000427".
 * This is a prototype convention, not a real national ID algorithm.
 *
 * Accepts either an ISO date string ("1988-03-14") or a JS Date — node-postgres returns a
 * DATE column as a native Date object, not a string, so a caller passing a row value straight
 * from the database (e.g. record.date_of_birth) must not silently produce a garbled ID by
 * having it stringified via Date.prototype.toString() (e.g. "Wed Mar 14 1988 ...").
 */
function toISODateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function generatePermanentIdentityNumber(dateOfBirth) {
  const yyyymmdd = toISODateOnly(dateOfBirth).replace(/-/g, '');
  const suffix = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  return `${yyyymmdd}${suffix}`;
}

/**
 * Inserts a new citizen row with a freshly generated permanent identity number, retrying on the
 * rare unique-constraint collision. `insertFn` must attempt the insert and throw on conflict
 * (a Postgres unique_violation has code '23505').
 */
async function withUniquePermanentId(dateOfBirthISO, insertFn, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generatePermanentIdentityNumber(dateOfBirthISO);
    try {
      return await insertFn(candidate);
    } catch (err) {
      if (err && err.code === '23505') {
        lastErr = err;
        continue; // collision on permanent_identity_number — try again
      }
      throw err;
    }
  }
  throw lastErr || new Error('Failed to generate a unique permanent identity number');
}

module.exports = { generatePermanentIdentityNumber, withUniquePermanentId };
