/**
 * Role-based access control. Usage: router.get('/x', requireAuth, requireRole('police_officer'), handler)
 * Always used AFTER requireAuth, which populates req.user.roleKey.
 */
function requireRole(...allowedRoleKeys) {
  return (req, res, next) => {
    if (!req.user || !allowedRoleKeys.includes(req.user.roleKey)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

/** Any authenticated employee (any *_officer role or system_administrator) — not a citizen. */
function requireEmployee(req, res, next) {
  if (!req.user || req.user.roleKey === 'citizen') {
    return res.status(403).json({ error: 'This action is restricted to government employees.' });
  }
  next();
}

const requireAdmin = requireRole('system_administrator');

module.exports = { requireRole, requireEmployee, requireAdmin };
