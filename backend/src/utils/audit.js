const db = require('../config/db');

/**
 * Writes an append-only audit_logs entry. Used for every sensitive access (Police lookups
 * above all, but also approvals, corrections and admin changes). Never throws to the caller —
 * a failed audit write should be logged but must not block the underlying action from
 * completing in a prototype context (in production this would instead be a hard failure).
 */
async function recordAudit({ userId, departmentId, action, targetType, targetId = null, reason = null, metadata = null }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, department_id, action, target_type, target_id, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, departmentId, action, targetType, targetId, reason, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to write audit log', err);
  }
}

module.exports = { recordAudit };
