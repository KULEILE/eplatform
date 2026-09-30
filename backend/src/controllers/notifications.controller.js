const db = require('../config/db');

/** GET /api/notifications */
async function list(req, res, next) {
  try {
    const { rows } = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.user.userId]
    );
    const unreadCount = rows.filter((n) => !n.is_read).length;
    res.json({ notifications: rows, unreadCount });
  } catch (err) { next(err); }
}

/** POST /api/notifications/:id/read */
async function markRead(req, res, next) {
  try {
    const { rows } = await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE notification_id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.user.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ notification: rows[0] });
  } catch (err) { next(err); }
}

/** POST /api/notifications/read-all */
async function markAllRead(req, res, next) {
  try {
    await db.query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE', [req.user.userId]);
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports = { list, markRead, markAllRead };
