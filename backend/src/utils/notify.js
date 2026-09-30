const db = require('../config/db');

const VALID_TYPES = new Set([
  'Application Submitted', 'Verification', 'Missing Information', 'Status Change',
  'Approval', 'Rejection', 'Ready for Collection', 'Collection Reminder',
  'Processing Delay', 'System',
]);

/** Creates an in-app notification. `language` should match the recipient's preferred_language
 *  where known, so History renders correctly even after the user later changes languages. */
async function createNotification({ userId, title, message, type, applicationId = null, language = 'en' }) {
  if (!VALID_TYPES.has(type)) throw new Error(`Invalid notification_type: ${type}`);
  await db.query(
    `INSERT INTO notifications (user_id, title, message, language, notification_type, related_application_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, title, message, language, type, applicationId]
  );
}

module.exports = { createNotification };
