const db = require('../config/db');
const { getDepartmentId } = require('../utils/lookup');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('../utils/notify');

// ============================================================================================
// APPOINTMENTS
//
// The appointments table (migration 017) is reserved for processes that genuinely require
// physical attendance. This controller adds the one thing that table never had: a way to
// actually book, view and manage one.
//
// It also carries the interpreter-assisted / accommodation fields (migration 027) — optional
// on every appointment, not a separate feature — for a citizen who needs a sign-language
// interpreter or another accommodation arranged ahead of a visit.
//
// status flow: Scheduled -> Completed | Missed | Cancelled (terminal). A citizen may cancel
// their own Scheduled appointment; only an officer/admin may mark Completed or Missed.
// ============================================================================================

const PURPOSES = ['Identity Enrolment', 'Biometric Capture', 'Document Collection', 'Physical Verification'];

function isEmployeeFor(user) {
  return user.roleKey !== 'citizen';
}

/** POST /api/appointments — citizen books an appointment (optionally interpreter-assisted). */
async function create(req, res, next) {
  try {
    if (!req.user.citizenId) {
      return res.status(403).json({ error: 'A verified identity is required to book an appointment.' });
    }
    const {
      departmentKey, officeId, applicationId, appointmentDate, appointmentTime, purpose,
      needsInterpreter, interpreterLanguage, accommodationNotes,
    } = req.body;
    if (!departmentKey || !appointmentDate || !appointmentTime || !purpose) {
      return res.status(400).json({ error: 'departmentKey, appointmentDate, appointmentTime and purpose are required.' });
    }
    if (!PURPOSES.includes(purpose)) {
      return res.status(400).json({ error: `purpose must be one of: ${PURPOSES.join(', ')}` });
    }
    let departmentId;
    try {
      departmentId = await getDepartmentId(departmentKey);
    } catch {
      return res.status(400).json({ error: 'Unknown departmentKey.' });
    }

    const { rows } = await db.query(
      `INSERT INTO appointments (
         citizen_id, application_id, department_id, office_id, appointment_date, appointment_time,
         purpose, needs_interpreter, interpreter_language, accommodation_notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.user.citizenId, applicationId || null, departmentId, officeId || null, appointmentDate, appointmentTime,
        purpose, !!needsInterpreter, (needsInterpreter && interpreterLanguage) || null, accommodationNotes || null,
      ]
    );
    const appointment = rows[0];

    await recordAudit({
      userId: req.user.userId, departmentId, action: 'APPOINTMENT_REQUESTED',
      targetType: 'appointment', targetId: appointment.appointment_id,
      metadata: { departmentKey, purpose, needsInterpreter: !!needsInterpreter },
    });
    await createNotification({
      userId: req.user.userId, title: 'Appointment requested',
      message: `Your appointment request for ${appointmentDate} has been received and is Scheduled. You'll be contacted if anything needs to change.`,
      type: 'System',
    });

    res.status(201).json({ appointment });
  } catch (err) { next(err); }
}

/** GET /api/appointments — citizen: own appointments. Employee: their department's queue. Admin: everything. */
async function list(req, res, next) {
  try {
    const { status } = req.query;
    if (req.user.roleKey === 'citizen') {
      if (!req.user.citizenId) return res.json({ appointments: [] });
      const { rows } = await db.query(
        `SELECT a.*, d.name AS department_name, o.name AS office_name
         FROM appointments a
         JOIN departments d ON d.department_id = a.department_id
         LEFT JOIN offices o ON o.office_id = a.office_id
         WHERE a.citizen_id = $1 AND ($2::text IS NULL OR a.status = $2)
         ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
        [req.user.citizenId, status || null]
      );
      return res.json({ appointments: rows });
    }
    if (req.user.roleKey === 'system_administrator') {
      const { rows } = await db.query(
        `SELECT a.*, d.name AS department_name, o.name AS office_name, c.first_name, c.last_name
         FROM appointments a
         JOIN departments d ON d.department_id = a.department_id
         JOIN citizens c ON c.citizen_id = a.citizen_id
         LEFT JOIN offices o ON o.office_id = a.office_id
         WHERE ($1::text IS NULL OR a.status = $1)
         ORDER BY a.appointment_date, a.appointment_time`,
        [status || null]
      );
      return res.json({ appointments: rows });
    }
    // Employee: restricted to their own department's appointments (matches the applications queue's scoping).
    const { rows } = await db.query(
      `SELECT a.*, o.name AS office_name, c.first_name, c.last_name
       FROM appointments a
       JOIN departments d ON d.department_id = a.department_id
       JOIN citizens c ON c.citizen_id = a.citizen_id
       LEFT JOIN offices o ON o.office_id = a.office_id
       WHERE d.department_key = $1 AND ($2::text IS NULL OR a.status = $2)
       ORDER BY a.appointment_date, a.appointment_time`,
      [req.user.departmentKey, status || null]
    );
    res.json({ appointments: rows });
  } catch (err) { next(err); }
}

/** GET /api/appointments/:id */
async function getOne(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT a.*, d.department_key, d.name AS department_name, o.name AS office_name,
              c.first_name, c.last_name
       FROM appointments a
       JOIN departments d ON d.department_id = a.department_id
       JOIN citizens c ON c.citizen_id = a.citizen_id
       LEFT JOIN offices o ON o.office_id = a.office_id
       WHERE a.appointment_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Appointment not found.' });
    const appointment = rows[0];
    const isOwner = req.user.citizenId && appointment.citizen_id === req.user.citizenId;
    const isDeptOfficer = req.user.departmentKey === appointment.department_key;
    const isAdmin = req.user.roleKey === 'system_administrator';
    if (!isOwner && !isDeptOfficer && !isAdmin) return res.status(403).json({ error: 'You do not have access to this appointment.' });
    res.json({ appointment });
  } catch (err) { next(err); }
}

/** PATCH /api/appointments/:id/status — { status: 'Completed'|'Missed'|'Cancelled' } */
async function updateStatus(req, res, next) {
  try {
    const { status } = req.body;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT a.*, d.department_key FROM appointments a JOIN departments d ON d.department_id = a.department_id
         WHERE a.appointment_id = $1 FOR UPDATE`,
        [req.params.id]
      );
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Appointment not found.' }); }
      const appointment = rows[0];
      const isOwner = req.user.citizenId && appointment.citizen_id === req.user.citizenId;
      const isDeptOfficer = isEmployeeFor(req.user) && req.user.departmentKey === appointment.department_key;
      const isAdmin = req.user.roleKey === 'system_administrator';

      if (appointment.status !== 'Scheduled') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Appointment is already ${appointment.status}.` });
      }
      if (status === 'Cancelled') {
        if (!isOwner && !isDeptOfficer && !isAdmin) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'You do not have access to this appointment.' }); }
      } else if (status === 'Completed' || status === 'Missed') {
        if (!isDeptOfficer && !isAdmin) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Only the handling department can record the outcome of an appointment.' }); }
      } else {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: "status must be one of: 'Completed', 'Missed', 'Cancelled'." });
      }

      const { rows: updated } = await client.query(
        `UPDATE appointments SET status = $1::varchar, updated_at = NOW() WHERE appointment_id = $2 RETURNING *`,
        [status, appointment.appointment_id]
      );
      await client.query('COMMIT');

      await recordAudit({
        userId: req.user.userId, departmentId: appointment.department_id, action: 'APPOINTMENT_STATUS_UPDATED',
        targetType: 'appointment', targetId: appointment.appointment_id, metadata: { from: 'Scheduled', to: status },
      });
      res.json({ appointment: updated[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

module.exports = { create, list, getOne, updateStatus, PURPOSES };
