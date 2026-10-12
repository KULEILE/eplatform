const db = require('./../config/db');

const OFFICER_ROLES = ['home_affairs_officer', 'system_administrator'];

/**
 * Generic status-transition helper for the simple "citizen submits -> officer reviews -> may
 * ask for more information -> citizen resubmits -> officer approves/rejects" shape shared by
 * the Home Affairs services added in migrations 037-041 (reissue, death certificate requests,
 * name change, adoption, burial orders, special marriage licence, solemnisation booking).
 *
 * This mirrors the hand-written transitionMarriage/transitionDivorce pattern already used
 * elsewhere in homeAffairs.controller.js (lock the row, check ownership, check the current
 * status allows the move, run a caller-supplied side effect, commit) rather than changing that
 * existing code, so eight near-identical copies of the same BEGIN/lock/check/COMMIT boilerplate
 * don't have to be hand-written again for every new table.
 *
 * `ownerColumn` defaults to 'citizen_id', which every new table in migrations 037-041 uses for
 * the filer except foreign_identity_enrolments (keyed on applicant_user_id instead, and handled
 * with its own bespoke functions rather than this helper — see the "FOREIGN IDENTITY ENROLMENT"
 * section of homeAffairsServices2.controller.js).
 */
function buildTransition({ table, idColumn, ownerColumn = 'citizen_id', notFoundMessage = 'Request not found.' }) {
  return async function transition(req, res, next, { from, to, allowOwner = false, sideEffect }) {
    try {
      const isOfficer = OFFICER_ROLES.includes(req.user.roleKey);
      if (!isOfficer && !allowOwner) {
        return res.status(403).json({ error: 'Officer only.' });
      }
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(`SELECT * FROM ${table} WHERE ${idColumn} = $1 FOR UPDATE`, [req.params.id]);
        if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: notFoundMessage }); }
        const record = rows[0];
        if (!isOfficer && record[ownerColumn] !== req.user.citizenId) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Not your request.' });
        }
        if (Array.isArray(from) ? !from.includes(record.status) : record.status !== from) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: `Cannot move from '${record.status}' to '${to}'.` });
        }
        const result = await (sideEffect ? sideEffect(client, record, req) : Promise.resolve({}));
        await client.query('COMMIT');
        res.json({ [idColumn]: record[idColumn], status: (result && result.status) || to, ...((result && result.extra) || {}) });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  };
}

module.exports = { buildTransition, OFFICER_ROLES };
