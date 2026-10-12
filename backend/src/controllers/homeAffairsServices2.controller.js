// ============================================================================================
// HOME AFFAIRS — ADDITIONAL SERVICES (migrations 037-041)
//
// Ten services were added on top of the existing Home Affairs department: National ID
// renewal/replacement (handled inside homeAffairs.controller.js, next to applyNationalId,
// since it reuses that table and its existing approval pipeline unchanged), and the nine
// handled in this file: birth certificate reissue, death certificate issuance, name change,
// adoption registration, burial orders, special marriage licence, civil marriage
// solemnisation booking, registration of marriage officers, and identity enrolment for
// non-citizens/refugees.
//
// Seven of these (reissue, death certificate, name change, adoption, burial order, special
// licence, solemnisation booking) share the same shape every other Home Affairs workflow
// already uses: citizen submits -> officer reviews -> officer may ask for more information ->
// citizen resubmits -> officer approves or rejects. That shared shape is factored into
// utils/workflow.js's buildTransition() instead of being hand-written eight times.
//
// Marriage officer registration has no citizen applicant at all — it is an internal registry
// Home Affairs officers maintain directly, the same devolved-admin shape districts/offices
// already use.
//
// Identity enrolment for non-citizens/refugees is keyed on the LOGGED-IN USER (users.user_id),
// not a citizens row, because the applicant by definition has none yet. Because the shared
// `applications` index table requires a NOT NULL citizen_id, foreign identity enrolments are
// NOT indexed there and do not appear in the generic "My Applications" list — this service
// tracks its own status/timeline instead via this table directly.
// ============================================================================================

const db = require('../config/db');
const { generateReference } = require('../utils/referenceGenerator');
const { withUniquePermanentId } = require('../utils/idGenerator');
const { indexApplication, syncApplicationStatus, getDepartmentId } = require('../utils/lookup');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');
const { buildTransition, OFFICER_ROLES } = require('../utils/workflow');

function isOfficer(req) { return OFFICER_ROLES.includes(req.user.roleKey); }

// ============================================================================================
// BIRTH CERTIFICATE REISSUE
// ============================================================================================

/** POST /api/home-affairs/birth-certificate-reissue  body: { birthRecordId, reason, details } */
async function requestBirthCertificateReissue(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to request a reissue.' });
    const { birthRecordId, reason, details } = req.body;
    if (!birthRecordId || !reason) return res.status(400).json({ error: 'birthRecordId and reason are required.' });
    const { rows: brRows } = await db.query('SELECT * FROM birth_records WHERE birth_record_id = $1', [birthRecordId]);
    if (brRows.length === 0) return res.status(404).json({ error: 'Birth record not found.' });
    const birthRecord = brRows[0];
    if (birthRecord.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'This birth record is not linked to your identity.' });
    if (birthRecord.registration_status !== 'Approved') return res.status(409).json({ error: 'No certificate has been issued for this birth registration yet.' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const reissueReference = generateReference('BCR');
      const { rows } = await client.query(
        `INSERT INTO birth_certificate_reissue_requests (citizen_id, birth_record_id, reason, details, reissue_reference)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.citizenId, birthRecordId, reason, details || null, reissueReference]
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Birth Certificate Reissue',
        referenceNumber: reissueReference, sourceTable: 'birth_certificate_reissue_requests', sourceId: rows[0].reissue_request_id, status: 'Submitted',
      });
      await client.query('COMMIT');
      res.status(201).json({ reissueRequest: rows[0] });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } catch (err) { next(err); }
}

async function listBirthCertificateReissues(req, res, next) {
  try {
    if (isOfficer(req)) {
      const { rows } = await db.query(
        `SELECT r.*, c.first_name, c.last_name, bc.birth_certificate_id FROM birth_certificate_reissue_requests r
         JOIN citizens c ON c.citizen_id = r.citizen_id
         LEFT JOIN birth_certificates bc ON bc.birth_record_id = r.birth_record_id
         ORDER BY r.requested_at DESC`
      );
      return res.json({ reissueRequests: rows });
    }
    if (!req.user.citizenId) return res.json({ reissueRequests: [] });
    const { rows } = await db.query(
      `SELECT r.*, bc.birth_certificate_id FROM birth_certificate_reissue_requests r
       LEFT JOIN birth_certificates bc ON bc.birth_record_id = r.birth_record_id
       WHERE r.citizen_id = $1 ORDER BY r.requested_at DESC`,
      [req.user.citizenId]
    );
    res.json({ reissueRequests: rows });
  } catch (err) { next(err); }
}

async function getBirthCertificateReissue(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT r.*, c.first_name, c.last_name, br.child_first_name, br.child_last_name,
              bc.birth_certificate_id, bc.status AS certificate_status
       FROM birth_certificate_reissue_requests r
       JOIN citizens c ON c.citizen_id = r.citizen_id
       JOIN birth_records br ON br.birth_record_id = r.birth_record_id
       LEFT JOIN birth_certificates bc ON bc.birth_record_id = r.birth_record_id
       WHERE r.reissue_request_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Reissue request not found.' });
    const record = rows[0];
    if (!isOfficer(req) && record.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'You do not have access to this request.' });
    res.json({ reissueRequest: record });
  } catch (err) { next(err); }
}

const transitionReissue = buildTransition({ table: 'birth_certificate_reissue_requests', idColumn: 'reissue_request_id', notFoundMessage: 'Reissue request not found.' });

function startReviewReissue(req, res, next) {
  return transitionReissue(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE birth_certificate_reissue_requests SET status = 'Under Review', updated_at = NOW() WHERE reissue_request_id = $1`, [record.reissue_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_certificate_reissue_requests', sourceId: record.reissue_request_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function requestInformationReissue(req, res, next) {
  const { reason } = req.body;
  return transitionReissue(req, res, next, {
    from: ['Under Review'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE birth_certificate_reissue_requests SET status = 'Additional Information Required', updated_at = NOW() WHERE reissue_request_id = $1`, [record.reissue_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_certificate_reissue_requests', sourceId: record.reissue_request_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.reissue_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

function resubmitReissue(req, res, next) {
  const { reason, details } = req.body;
  return transitionReissue(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('reason is required.'), { status: 400 });
      await client.query(
        `UPDATE birth_certificate_reissue_requests SET status = 'Under Review', rejection_reason = NULL, reason = $1, details = $2, updated_at = NOW() WHERE reissue_request_id = $3`,
        [reason, details || null, record.reissue_request_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'birth_certificate_reissue_requests', sourceId: record.reissue_request_id, status: 'Under Review', note: 'Citizen resubmitted.' });
      return { status: 'Under Review' };
    },
  });
}

function approveReissue(req, res, next) {
  return transitionReissue(req, res, next, {
    from: ['Under Review'], to: 'Approved',
    sideEffect: async (client, record, req2) => {
      await client.query(`UPDATE birth_certificate_reissue_requests SET status = 'Approved', reviewed_by_user_id = $1, reviewed_at = NOW(), updated_at = NOW() WHERE reissue_request_id = $2`, [req2.user.userId, record.reissue_request_id]);
      // Re-opens the existing certificate for collection, same as a brand-new one.
      await client.query(`UPDATE birth_certificates SET status = 'Ready for Collection', ready_for_collection_at = NOW(), updated_at = NOW() WHERE birth_record_id = $1`, [record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_certificate_reissue_requests', sourceId: record.reissue_request_id, status: 'Approved', completed: true, changedByUserId: req2.user.userId });
      await recordAudit({ userId: req2.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'BIRTH_CERTIFICATE_REISSUE_APPROVED', targetType: 'birth_certificate_reissue_request', targetId: record.reissue_request_id });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Birth certificate reissue approved', message: `Reference ${record.reissue_reference}. Your certificate is ready for collection.`, type: 'Approval' });
      return { status: 'Approved' };
    },
  });
}

function rejectReissue(req, res, next) {
  const { reason } = req.body;
  return transitionReissue(req, res, next, {
    from: ['Submitted', 'Under Review', 'Additional Information Required'], to: 'Rejected',
    sideEffect: async (client, record, req2) => {
      if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
      await client.query(`UPDATE birth_certificate_reissue_requests SET status = 'Rejected', rejection_reason = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE reissue_request_id = $3`, [reason, req2.user.userId, record.reissue_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_certificate_reissue_requests', sourceId: record.reissue_request_id, status: 'Rejected', completed: true, changedByUserId: req2.user.userId, note: reason });
      return { status: 'Rejected' };
    },
  });
}

// ============================================================================================
// DEATH CERTIFICATE ISSUANCE (distinct from death REGISTRATION, migration 020)
// ============================================================================================

/** POST /api/home-affairs/death-certificate-request  body: { deathRecordId, relationshipToDeceased, reason, details } */
async function requestDeathCertificate(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to request a death certificate.' });
    const { deathRecordId, relationshipToDeceased, reason, details } = req.body;
    if (!deathRecordId || !relationshipToDeceased || !reason) return res.status(400).json({ error: 'deathRecordId, relationshipToDeceased and reason are required.' });
    const { rows: drRows } = await db.query('SELECT * FROM death_records WHERE death_record_id = $1', [deathRecordId]);
    if (drRows.length === 0) return res.status(404).json({ error: 'Death record not found.' });
    if (drRows[0].status !== 'Approved') return res.status(409).json({ error: 'This death has not been registered yet — the registration must be approved before a certificate can be requested.' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const requestReference = generateReference('DCR');
      const { rows } = await client.query(
        `INSERT INTO death_certificate_requests (citizen_id, death_record_id, relationship_to_deceased, reason, details, request_reference)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.user.citizenId, deathRecordId, relationshipToDeceased, reason, details || null, requestReference]
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Death Certificate Issuance',
        referenceNumber: requestReference, sourceTable: 'death_certificate_requests', sourceId: rows[0].death_certificate_request_id, status: 'Submitted',
      });
      await client.query('COMMIT');
      res.status(201).json({ deathCertificateRequest: rows[0] });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } catch (err) { next(err); }
}

async function listDeathCertificateRequests(req, res, next) {
  try {
    if (isOfficer(req)) {
      const { rows } = await db.query(
        `SELECT q.*, c.first_name, c.last_name, dc.first_name AS deceased_first_name, dc.last_name AS deceased_last_name
         FROM death_certificate_requests q
         JOIN citizens c ON c.citizen_id = q.citizen_id
         JOIN death_records dr ON dr.death_record_id = q.death_record_id
         JOIN citizens dc ON dc.citizen_id = dr.citizen_id
         ORDER BY q.requested_at DESC`
      );
      return res.json({ deathCertificateRequests: rows });
    }
    if (!req.user.citizenId) return res.json({ deathCertificateRequests: [] });
    const { rows } = await db.query(
      `SELECT q.*, dc.first_name AS deceased_first_name, dc.last_name AS deceased_last_name
       FROM death_certificate_requests q
       JOIN death_records dr ON dr.death_record_id = q.death_record_id
       JOIN citizens dc ON dc.citizen_id = dr.citizen_id
       WHERE q.citizen_id = $1 ORDER BY q.requested_at DESC`,
      [req.user.citizenId]
    );
    res.json({ deathCertificateRequests: rows });
  } catch (err) { next(err); }
}

async function getDeathCertificateRequest(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT q.*, c.first_name, c.last_name,
              dr.date_of_death, dr.place_of_death, dr.registration_reference AS death_registration_reference,
              dc.first_name AS deceased_first_name, dc.middle_name AS deceased_middle_name, dc.last_name AS deceased_last_name,
              dc.permanent_identity_number AS deceased_permanent_identity_number, dc.date_of_birth AS deceased_date_of_birth, dc.sex AS deceased_sex
       FROM death_certificate_requests q
       JOIN citizens c ON c.citizen_id = q.citizen_id
       JOIN death_records dr ON dr.death_record_id = q.death_record_id
       JOIN citizens dc ON dc.citizen_id = dr.citizen_id
       WHERE q.death_certificate_request_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Death certificate request not found.' });
    const record = rows[0];
    if (!isOfficer(req) && record.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'You do not have access to this request.' });
    res.json({ deathCertificateRequest: record });
  } catch (err) { next(err); }
}

const transitionDeathCertRequest = buildTransition({ table: 'death_certificate_requests', idColumn: 'death_certificate_request_id', notFoundMessage: 'Death certificate request not found.' });

function startReviewDeathCertRequest(req, res, next) {
  return transitionDeathCertRequest(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE death_certificate_requests SET status = 'Under Review', updated_at = NOW() WHERE death_certificate_request_id = $1`, [record.death_certificate_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'death_certificate_requests', sourceId: record.death_certificate_request_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function requestInformationDeathCertRequest(req, res, next) {
  const { reason } = req.body;
  return transitionDeathCertRequest(req, res, next, {
    from: ['Under Review'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE death_certificate_requests SET status = 'Additional Information Required', updated_at = NOW() WHERE death_certificate_request_id = $1`, [record.death_certificate_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'death_certificate_requests', sourceId: record.death_certificate_request_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.request_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

function resubmitDeathCertRequest(req, res, next) {
  const { relationshipToDeceased, reason, details } = req.body;
  return transitionDeathCertRequest(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!relationshipToDeceased || !reason) throw Object.assign(new Error('relationshipToDeceased and reason are required.'), { status: 400 });
      await client.query(
        `UPDATE death_certificate_requests SET status = 'Under Review', rejection_reason = NULL,
            relationship_to_deceased = $1, reason = $2, details = $3, updated_at = NOW() WHERE death_certificate_request_id = $4`,
        [relationshipToDeceased, reason, details || null, record.death_certificate_request_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'death_certificate_requests', sourceId: record.death_certificate_request_id, status: 'Under Review', note: 'Citizen resubmitted.' });
      return { status: 'Under Review' };
    },
  });
}

function approveDeathCertRequest(req, res, next) {
  return transitionDeathCertRequest(req, res, next, {
    from: ['Under Review'], to: 'Approved',
    sideEffect: async (client, record, req2) => {
      await client.query(`UPDATE death_certificate_requests SET status = 'Approved', reviewed_by_user_id = $1, reviewed_at = NOW(), updated_at = NOW() WHERE death_certificate_request_id = $2`, [req2.user.userId, record.death_certificate_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'death_certificate_requests', sourceId: record.death_certificate_request_id, status: 'Approved', completed: true, changedByUserId: req2.user.userId });
      await recordAudit({ userId: req2.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'DEATH_CERTIFICATE_APPROVED', targetType: 'death_certificate_request', targetId: record.death_certificate_request_id });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Death certificate issued', message: `Reference ${record.request_reference}. The certificate is now available to view.`, type: 'Approval' });
      return { status: 'Approved' };
    },
  });
}

function rejectDeathCertRequest(req, res, next) {
  const { reason } = req.body;
  return transitionDeathCertRequest(req, res, next, {
    from: ['Submitted', 'Under Review', 'Additional Information Required'], to: 'Rejected',
    sideEffect: async (client, record, req2) => {
      if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
      await client.query(`UPDATE death_certificate_requests SET status = 'Rejected', rejection_reason = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE death_certificate_request_id = $3`, [reason, req2.user.userId, record.death_certificate_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'death_certificate_requests', sourceId: record.death_certificate_request_id, status: 'Rejected', completed: true, changedByUserId: req2.user.userId, note: reason });
      return { status: 'Rejected' };
    },
  });
}

// ============================================================================================
// CHANGE / ALTERATION OF NAME OR SURNAME (formal legal change — distinct from "corrections",
// which only fixes data-entry errors)
// ============================================================================================

/** POST /api/home-affairs/name-change  body: { requestedFirstName, requestedLastName, reasonCategory, reasonDetails } */
async function requestNameChange(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to request a name change.' });
    const { requestedFirstName, requestedLastName, reasonCategory, reasonDetails } = req.body;
    if (!requestedFirstName || !requestedLastName || !reasonCategory || !reasonDetails) {
      return res.status(400).json({ error: 'requestedFirstName, requestedLastName, reasonCategory and reasonDetails are required.' });
    }
    const { rows: citizenRows } = await db.query('SELECT first_name, last_name FROM citizens WHERE citizen_id = $1', [req.user.citizenId]);
    const citizen = citizenRows[0];

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const referenceNumber = generateReference('NCR');
      const { rows } = await client.query(
        `INSERT INTO name_change_requests (citizen_id, request_reference, current_first_name, current_last_name, requested_first_name, requested_last_name, reason_category, reason_details)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.user.citizenId, referenceNumber, citizen.first_name, citizen.last_name, requestedFirstName, requestedLastName, reasonCategory, reasonDetails]
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Change of Name/Surname',
        referenceNumber, sourceTable: 'name_change_requests', sourceId: rows[0].name_change_request_id, status: 'Submitted',
      });
      await client.query('COMMIT');
      res.status(201).json({ nameChangeRequest: rows[0] });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } catch (err) { next(err); }
}

async function listNameChangeRequests(req, res, next) {
  try {
    if (isOfficer(req)) {
      const { rows } = await db.query(
        `SELECT n.*, c.first_name AS live_first_name, c.last_name AS live_last_name FROM name_change_requests n
         JOIN citizens c ON c.citizen_id = n.citizen_id ORDER BY n.requested_at DESC`
      );
      return res.json({ nameChangeRequests: rows });
    }
    if (!req.user.citizenId) return res.json({ nameChangeRequests: [] });
    const { rows } = await db.query('SELECT * FROM name_change_requests WHERE citizen_id = $1 ORDER BY requested_at DESC', [req.user.citizenId]);
    res.json({ nameChangeRequests: rows });
  } catch (err) { next(err); }
}

async function getNameChangeRequest(req, res, next) {
  try {
    const { rows } = await db.query('SELECT * FROM name_change_requests WHERE name_change_request_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Name change request not found.' });
    const record = rows[0];
    if (!isOfficer(req) && record.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'You do not have access to this request.' });
    res.json({ nameChangeRequest: record });
  } catch (err) { next(err); }
}

const transitionNameChange = buildTransition({ table: 'name_change_requests', idColumn: 'name_change_request_id', notFoundMessage: 'Name change request not found.' });

function startReviewNameChange(req, res, next) {
  return transitionNameChange(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE name_change_requests SET status = 'Under Review', updated_at = NOW() WHERE name_change_request_id = $1`, [record.name_change_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'name_change_requests', sourceId: record.name_change_request_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function requestInformationNameChange(req, res, next) {
  const { reason } = req.body;
  return transitionNameChange(req, res, next, {
    from: ['Under Review'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE name_change_requests SET status = 'Additional Information Required', updated_at = NOW() WHERE name_change_request_id = $1`, [record.name_change_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'name_change_requests', sourceId: record.name_change_request_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.request_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

function resubmitNameChange(req, res, next) {
  const { requestedFirstName, requestedLastName, reasonCategory, reasonDetails } = req.body;
  return transitionNameChange(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!requestedFirstName || !requestedLastName || !reasonCategory || !reasonDetails) {
        throw Object.assign(new Error('requestedFirstName, requestedLastName, reasonCategory and reasonDetails are required.'), { status: 400 });
      }
      await client.query(
        `UPDATE name_change_requests SET status = 'Under Review', rejection_reason = NULL,
            requested_first_name = $1, requested_last_name = $2, reason_category = $3, reason_details = $4, updated_at = NOW()
         WHERE name_change_request_id = $5`,
        [requestedFirstName, requestedLastName, reasonCategory, reasonDetails, record.name_change_request_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'name_change_requests', sourceId: record.name_change_request_id, status: 'Under Review', note: 'Citizen resubmitted.' });
      return { status: 'Under Review' };
    },
  });
}

function approveNameChange(req, res, next) {
  return transitionNameChange(req, res, next, {
    from: ['Under Review'], to: 'Approved',
    sideEffect: async (client, record, req2) => {
      const approvalReference = generateReference('NCA');
      await client.query(
        `UPDATE name_change_requests SET status = 'Approved', approval_reference = $1, effective_date = CURRENT_DATE,
            reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE name_change_request_id = $3`,
        [approvalReference, req2.user.userId, record.name_change_request_id]
      );
      await client.query(
        `UPDATE citizens SET first_name = $1, last_name = $2, updated_at = NOW() WHERE citizen_id = $3`,
        [record.requested_first_name, record.requested_last_name, record.citizen_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'name_change_requests', sourceId: record.name_change_request_id, status: 'Approved', completed: true, changedByUserId: req2.user.userId });
      await recordAudit({ userId: req2.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'NAME_CHANGE_APPROVED', targetType: 'name_change_request', targetId: record.name_change_request_id });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Name change approved', message: `Reference ${approvalReference}. Your name has been updated to ${record.requested_first_name} ${record.requested_last_name}.`, type: 'Approval' });
      return { status: 'Approved', extra: { approvalReference } };
    },
  });
}

function rejectNameChange(req, res, next) {
  const { reason } = req.body;
  return transitionNameChange(req, res, next, {
    from: ['Submitted', 'Under Review', 'Additional Information Required'], to: 'Rejected',
    sideEffect: async (client, record, req2) => {
      if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
      await client.query(`UPDATE name_change_requests SET status = 'Rejected', rejection_reason = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE name_change_request_id = $3`, [reason, req2.user.userId, record.name_change_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'name_change_requests', sourceId: record.name_change_request_id, status: 'Rejected', completed: true, changedByUserId: req2.user.userId, note: reason });
      return { status: 'Rejected' };
    },
  });
}

// ============================================================================================
// ADOPTION REGISTRATION
// ============================================================================================

/** POST /api/home-affairs/adoption  body: { childPermanentIdentityNumber, courtOrderReference, courtName, adoptionDate, reasonDetails } */
async function requestAdoption(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to register an adoption.' });
    const { childPermanentIdentityNumber, courtOrderReference, courtName, adoptionDate, reasonDetails } = req.body;
    if (!childPermanentIdentityNumber || !courtOrderReference || !adoptionDate) {
      return res.status(400).json({ error: 'childPermanentIdentityNumber, courtOrderReference and adoptionDate are required.' });
    }
    const { rows: childRows } = await db.query('SELECT citizen_id, parent_citizen_id FROM citizens WHERE permanent_identity_number = $1', [childPermanentIdentityNumber]);
    if (childRows.length === 0) return res.status(404).json({ error: 'No citizen record found for that permanent identity number.' });
    const child = childRows[0];
    if (child.citizen_id === req.user.citizenId) return res.status(400).json({ error: 'You cannot register an adoption for your own record.' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const registrationReference = generateReference('ADR');
      const { rows } = await client.query(
        `INSERT INTO adoption_records (citizen_id, child_citizen_id, previous_guardian_citizen_id, court_order_reference, court_name, adoption_date, reason_details, registration_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.user.citizenId, child.citizen_id, child.parent_citizen_id, courtOrderReference, courtName || null, adoptionDate, reasonDetails || null, registrationReference]
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Adoption Registration',
        referenceNumber: registrationReference, sourceTable: 'adoption_records', sourceId: rows[0].adoption_record_id, status: 'Submitted',
      });
      await client.query('COMMIT');
      res.status(201).json({ adoptionRecord: rows[0] });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } catch (err) { next(err); }
}

async function listAdoptions(req, res, next) {
  try {
    if (isOfficer(req)) {
      const { rows } = await db.query(
        `SELECT a.*, p.first_name AS parent_first_name, p.last_name AS parent_last_name,
                ch.first_name AS child_first_name, ch.last_name AS child_last_name
         FROM adoption_records a
         JOIN citizens p ON p.citizen_id = a.citizen_id
         JOIN citizens ch ON ch.citizen_id = a.child_citizen_id
         ORDER BY a.requested_at DESC`
      );
      return res.json({ adoptionRecords: rows });
    }
    if (!req.user.citizenId) return res.json({ adoptionRecords: [] });
    const { rows } = await db.query(
      `SELECT a.*, ch.first_name AS child_first_name, ch.last_name AS child_last_name
       FROM adoption_records a JOIN citizens ch ON ch.citizen_id = a.child_citizen_id
       WHERE a.citizen_id = $1 ORDER BY a.requested_at DESC`,
      [req.user.citizenId]
    );
    res.json({ adoptionRecords: rows });
  } catch (err) { next(err); }
}

async function getAdoption(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT a.*, p.first_name AS parent_first_name, p.last_name AS parent_last_name,
              ch.first_name AS child_first_name, ch.middle_name AS child_middle_name, ch.last_name AS child_last_name,
              ch.permanent_identity_number AS child_permanent_identity_number, ch.date_of_birth AS child_date_of_birth,
              pg.first_name AS previous_guardian_first_name, pg.last_name AS previous_guardian_last_name
       FROM adoption_records a
       JOIN citizens p ON p.citizen_id = a.citizen_id
       JOIN citizens ch ON ch.citizen_id = a.child_citizen_id
       LEFT JOIN citizens pg ON pg.citizen_id = a.previous_guardian_citizen_id
       WHERE a.adoption_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Adoption record not found.' });
    const record = rows[0];
    if (!isOfficer(req) && record.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'You do not have access to this record.' });
    res.json({ adoptionRecord: record });
  } catch (err) { next(err); }
}

const transitionAdoption = buildTransition({ table: 'adoption_records', idColumn: 'adoption_record_id', notFoundMessage: 'Adoption record not found.' });

function startReviewAdoption(req, res, next) {
  return transitionAdoption(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE adoption_records SET status = 'Under Review', updated_at = NOW() WHERE adoption_record_id = $1`, [record.adoption_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'adoption_records', sourceId: record.adoption_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function requestInformationAdoption(req, res, next) {
  const { reason } = req.body;
  return transitionAdoption(req, res, next, {
    from: ['Under Review'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE adoption_records SET status = 'Additional Information Required', updated_at = NOW() WHERE adoption_record_id = $1`, [record.adoption_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'adoption_records', sourceId: record.adoption_record_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.registration_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

function resubmitAdoption(req, res, next) {
  const { courtOrderReference, courtName, adoptionDate, reasonDetails } = req.body;
  return transitionAdoption(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!courtOrderReference || !adoptionDate) throw Object.assign(new Error('courtOrderReference and adoptionDate are required.'), { status: 400 });
      await client.query(
        `UPDATE adoption_records SET status = 'Under Review', rejection_reason = NULL,
            court_order_reference = $1, court_name = $2, adoption_date = $3, reason_details = $4, updated_at = NOW()
         WHERE adoption_record_id = $5`,
        [courtOrderReference, courtName || null, adoptionDate, reasonDetails || null, record.adoption_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'adoption_records', sourceId: record.adoption_record_id, status: 'Under Review', note: 'Citizen resubmitted.' });
      return { status: 'Under Review' };
    },
  });
}

function approveAdoption(req, res, next) {
  return transitionAdoption(req, res, next, {
    from: ['Under Review'], to: 'Approved',
    sideEffect: async (client, record, req2) => {
      await client.query(`UPDATE adoption_records SET status = 'Approved', reviewed_by_user_id = $1, reviewed_at = NOW(), updated_at = NOW() WHERE adoption_record_id = $2`, [req2.user.userId, record.adoption_record_id]);
      // The core effect of an approved adoption: the child's guardian link moves to the adoptive parent.
      await client.query(`UPDATE citizens SET parent_citizen_id = $1, updated_at = NOW() WHERE citizen_id = $2`, [record.citizen_id, record.child_citizen_id]);
      await syncApplicationStatus(client, { sourceTable: 'adoption_records', sourceId: record.adoption_record_id, status: 'Approved', completed: true, changedByUserId: req2.user.userId });
      await recordAudit({ userId: req2.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'ADOPTION_APPROVED', targetType: 'adoption_record', targetId: record.adoption_record_id });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Adoption registration approved', message: `Reference ${record.registration_reference}.`, type: 'Approval' });
      return { status: 'Approved' };
    },
  });
}

function rejectAdoption(req, res, next) {
  const { reason } = req.body;
  return transitionAdoption(req, res, next, {
    from: ['Submitted', 'Under Review', 'Additional Information Required'], to: 'Rejected',
    sideEffect: async (client, record, req2) => {
      if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
      await client.query(`UPDATE adoption_records SET status = 'Rejected', rejection_reason = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE adoption_record_id = $3`, [reason, req2.user.userId, record.adoption_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'adoption_records', sourceId: record.adoption_record_id, status: 'Rejected', completed: true, changedByUserId: req2.user.userId, note: reason });
      return { status: 'Rejected' };
    },
  });
}

// ============================================================================================
// ISSUING BURIAL ORDERS
// ============================================================================================

/** POST /api/home-affairs/burial-order  body: { deathRecordId, placeOfBurial, cemeteryOrSite, plannedBurialDate } */
async function requestBurialOrder(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to request a burial order.' });
    const { deathRecordId, placeOfBurial, cemeteryOrSite, plannedBurialDate } = req.body;
    if (!deathRecordId || !placeOfBurial || !plannedBurialDate) {
      return res.status(400).json({ error: 'deathRecordId, placeOfBurial and plannedBurialDate are required.' });
    }
    const { rows: drRows } = await db.query('SELECT * FROM death_records WHERE death_record_id = $1', [deathRecordId]);
    if (drRows.length === 0) return res.status(404).json({ error: 'Death record not found.' });
    if (drRows[0].status !== 'Approved') return res.status(409).json({ error: 'The death must be registered and approved before a burial order can be requested.' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const orderReference = generateReference('BUR');
      const { rows } = await client.query(
        `INSERT INTO burial_order_requests (citizen_id, death_record_id, place_of_burial, cemetery_or_site, planned_burial_date, order_reference)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.user.citizenId, deathRecordId, placeOfBurial, cemeteryOrSite || null, plannedBurialDate, orderReference]
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Burial Order',
        referenceNumber: orderReference, sourceTable: 'burial_order_requests', sourceId: rows[0].burial_order_request_id, status: 'Submitted',
      });
      await client.query('COMMIT');
      res.status(201).json({ burialOrderRequest: rows[0] });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } catch (err) { next(err); }
}

async function listBurialOrders(req, res, next) {
  try {
    if (isOfficer(req)) {
      const { rows } = await db.query(
        `SELECT b.*, c.first_name, c.last_name, dc.first_name AS deceased_first_name, dc.last_name AS deceased_last_name
         FROM burial_order_requests b
         JOIN citizens c ON c.citizen_id = b.citizen_id
         JOIN death_records dr ON dr.death_record_id = b.death_record_id
         JOIN citizens dc ON dc.citizen_id = dr.citizen_id
         ORDER BY b.requested_at DESC`
      );
      return res.json({ burialOrderRequests: rows });
    }
    if (!req.user.citizenId) return res.json({ burialOrderRequests: [] });
    const { rows } = await db.query(
      `SELECT b.*, dc.first_name AS deceased_first_name, dc.last_name AS deceased_last_name
       FROM burial_order_requests b
       JOIN death_records dr ON dr.death_record_id = b.death_record_id
       JOIN citizens dc ON dc.citizen_id = dr.citizen_id
       WHERE b.citizen_id = $1 ORDER BY b.requested_at DESC`,
      [req.user.citizenId]
    );
    res.json({ burialOrderRequests: rows });
  } catch (err) { next(err); }
}

async function getBurialOrder(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT b.*, c.first_name, c.last_name,
              dc.first_name AS deceased_first_name, dc.middle_name AS deceased_middle_name, dc.last_name AS deceased_last_name,
              dr.date_of_death
       FROM burial_order_requests b
       JOIN citizens c ON c.citizen_id = b.citizen_id
       JOIN death_records dr ON dr.death_record_id = b.death_record_id
       JOIN citizens dc ON dc.citizen_id = dr.citizen_id
       WHERE b.burial_order_request_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Burial order request not found.' });
    const record = rows[0];
    if (!isOfficer(req) && record.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'You do not have access to this request.' });
    res.json({ burialOrderRequest: record });
  } catch (err) { next(err); }
}

const transitionBurialOrder = buildTransition({ table: 'burial_order_requests', idColumn: 'burial_order_request_id', notFoundMessage: 'Burial order request not found.' });

function startReviewBurialOrder(req, res, next) {
  return transitionBurialOrder(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE burial_order_requests SET status = 'Under Review', updated_at = NOW() WHERE burial_order_request_id = $1`, [record.burial_order_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'burial_order_requests', sourceId: record.burial_order_request_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function requestInformationBurialOrder(req, res, next) {
  const { reason } = req.body;
  return transitionBurialOrder(req, res, next, {
    from: ['Under Review'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE burial_order_requests SET status = 'Additional Information Required', updated_at = NOW() WHERE burial_order_request_id = $1`, [record.burial_order_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'burial_order_requests', sourceId: record.burial_order_request_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.order_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

function resubmitBurialOrder(req, res, next) {
  const { placeOfBurial, cemeteryOrSite, plannedBurialDate } = req.body;
  return transitionBurialOrder(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!placeOfBurial || !plannedBurialDate) throw Object.assign(new Error('placeOfBurial and plannedBurialDate are required.'), { status: 400 });
      await client.query(
        `UPDATE burial_order_requests SET status = 'Under Review', rejection_reason = NULL,
            place_of_burial = $1, cemetery_or_site = $2, planned_burial_date = $3, updated_at = NOW()
         WHERE burial_order_request_id = $4`,
        [placeOfBurial, cemeteryOrSite || null, plannedBurialDate, record.burial_order_request_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'burial_order_requests', sourceId: record.burial_order_request_id, status: 'Under Review', note: 'Citizen resubmitted.' });
      return { status: 'Under Review' };
    },
  });
}

function approveBurialOrder(req, res, next) {
  return transitionBurialOrder(req, res, next, {
    from: ['Under Review'], to: 'Approved',
    sideEffect: async (client, record, req2) => {
      const orderNumber = generateReference('BO');
      await client.query(`UPDATE burial_order_requests SET status = 'Approved', order_number = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE burial_order_request_id = $3`, [orderNumber, req2.user.userId, record.burial_order_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'burial_order_requests', sourceId: record.burial_order_request_id, status: 'Approved', completed: true, changedByUserId: req2.user.userId });
      await recordAudit({ userId: req2.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'BURIAL_ORDER_APPROVED', targetType: 'burial_order_request', targetId: record.burial_order_request_id });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Burial order issued', message: `Reference ${record.order_reference}. Order number: ${orderNumber}.`, type: 'Approval' });
      return { status: 'Approved', extra: { orderNumber } };
    },
  });
}

function rejectBurialOrder(req, res, next) {
  const { reason } = req.body;
  return transitionBurialOrder(req, res, next, {
    from: ['Submitted', 'Under Review', 'Additional Information Required'], to: 'Rejected',
    sideEffect: async (client, record, req2) => {
      if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
      await client.query(`UPDATE burial_order_requests SET status = 'Rejected', rejection_reason = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE burial_order_request_id = $3`, [reason, req2.user.userId, record.burial_order_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'burial_order_requests', sourceId: record.burial_order_request_id, status: 'Rejected', completed: true, changedByUserId: req2.user.userId, note: reason });
      return { status: 'Rejected' };
    },
  });
}

// ============================================================================================
// SPECIAL MARRIAGE LICENCE
// ============================================================================================

/** POST /api/home-affairs/special-marriage-licence */
async function requestSpecialMarriageLicence(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to request a special marriage licence.' });
    const { spouse1Name, spouse1PermanentIdentityNumber, spouse2Name, spouse2Nationality, spouse2PermanentIdentityNumber, specialReason, reasonDetails } = req.body;
    if (!spouse1Name || !spouse2Name || !specialReason || !reasonDetails) {
      return res.status(400).json({ error: 'spouse1Name, spouse2Name, specialReason and reasonDetails are required.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const licenceReference = generateReference('SML');
      const { rows } = await client.query(
        `INSERT INTO special_marriage_licence_requests
            (citizen_id, spouse1_name, spouse1_permanent_identity_number, spouse2_name, spouse2_nationality, spouse2_permanent_identity_number, special_reason, reason_details, licence_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.user.citizenId, spouse1Name, spouse1PermanentIdentityNumber || null, spouse2Name, spouse2Nationality || null, spouse2PermanentIdentityNumber || null, specialReason, reasonDetails, licenceReference]
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Special Marriage Licence',
        referenceNumber: licenceReference, sourceTable: 'special_marriage_licence_requests', sourceId: rows[0].licence_request_id, status: 'Submitted',
      });
      await client.query('COMMIT');
      res.status(201).json({ licenceRequest: rows[0] });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } catch (err) { next(err); }
}

async function listSpecialMarriageLicences(req, res, next) {
  try {
    if (isOfficer(req)) {
      const { rows } = await db.query(
        `SELECT l.*, c.first_name, c.last_name FROM special_marriage_licence_requests l
         JOIN citizens c ON c.citizen_id = l.citizen_id ORDER BY l.requested_at DESC`
      );
      return res.json({ licenceRequests: rows });
    }
    if (!req.user.citizenId) return res.json({ licenceRequests: [] });
    const { rows } = await db.query('SELECT * FROM special_marriage_licence_requests WHERE citizen_id = $1 ORDER BY requested_at DESC', [req.user.citizenId]);
    res.json({ licenceRequests: rows });
  } catch (err) { next(err); }
}

async function getSpecialMarriageLicence(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT l.*, c.first_name, c.last_name FROM special_marriage_licence_requests l
       JOIN citizens c ON c.citizen_id = l.citizen_id WHERE l.licence_request_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Special marriage licence request not found.' });
    const record = rows[0];
    if (!isOfficer(req) && record.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'You do not have access to this request.' });
    res.json({ licenceRequest: record });
  } catch (err) { next(err); }
}

const transitionSpecialLicence = buildTransition({ table: 'special_marriage_licence_requests', idColumn: 'licence_request_id', notFoundMessage: 'Special marriage licence request not found.' });

function startReviewSpecialLicence(req, res, next) {
  return transitionSpecialLicence(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE special_marriage_licence_requests SET status = 'Under Review', updated_at = NOW() WHERE licence_request_id = $1`, [record.licence_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'special_marriage_licence_requests', sourceId: record.licence_request_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function requestInformationSpecialLicence(req, res, next) {
  const { reason } = req.body;
  return transitionSpecialLicence(req, res, next, {
    from: ['Under Review'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE special_marriage_licence_requests SET status = 'Additional Information Required', updated_at = NOW() WHERE licence_request_id = $1`, [record.licence_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'special_marriage_licence_requests', sourceId: record.licence_request_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.licence_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

function resubmitSpecialLicence(req, res, next) {
  const { spouse2Name, spouse2Nationality, spouse2PermanentIdentityNumber, specialReason, reasonDetails } = req.body;
  return transitionSpecialLicence(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!spouse2Name || !specialReason || !reasonDetails) throw Object.assign(new Error('spouse2Name, specialReason and reasonDetails are required.'), { status: 400 });
      await client.query(
        `UPDATE special_marriage_licence_requests SET status = 'Under Review', rejection_reason = NULL,
            spouse2_name = $1, spouse2_nationality = $2, spouse2_permanent_identity_number = $3, special_reason = $4, reason_details = $5, updated_at = NOW()
         WHERE licence_request_id = $6`,
        [spouse2Name, spouse2Nationality || null, spouse2PermanentIdentityNumber || null, specialReason, reasonDetails, record.licence_request_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'special_marriage_licence_requests', sourceId: record.licence_request_id, status: 'Under Review', note: 'Citizen resubmitted.' });
      return { status: 'Under Review' };
    },
  });
}

function approveSpecialLicence(req, res, next) {
  return transitionSpecialLicence(req, res, next, {
    from: ['Under Review'], to: 'Approved',
    sideEffect: async (client, record, req2) => {
      const licenceNumber = generateReference('SMLN');
      await client.query(
        `UPDATE special_marriage_licence_requests SET status = 'Approved', licence_number = $1, valid_from = CURRENT_DATE, valid_until = CURRENT_DATE + INTERVAL '1 year',
            reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE licence_request_id = $3`,
        [licenceNumber, req2.user.userId, record.licence_request_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'special_marriage_licence_requests', sourceId: record.licence_request_id, status: 'Approved', completed: true, changedByUserId: req2.user.userId });
      await recordAudit({ userId: req2.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'SPECIAL_MARRIAGE_LICENCE_APPROVED', targetType: 'special_marriage_licence_request', targetId: record.licence_request_id });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Special marriage licence approved', message: `Reference ${record.licence_reference}. Licence number: ${licenceNumber}.`, type: 'Approval' });
      return { status: 'Approved', extra: { licenceNumber } };
    },
  });
}

function rejectSpecialLicence(req, res, next) {
  const { reason } = req.body;
  return transitionSpecialLicence(req, res, next, {
    from: ['Submitted', 'Under Review', 'Additional Information Required'], to: 'Rejected',
    sideEffect: async (client, record, req2) => {
      if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
      await client.query(`UPDATE special_marriage_licence_requests SET status = 'Rejected', rejection_reason = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE licence_request_id = $3`, [reason, req2.user.userId, record.licence_request_id]);
      await syncApplicationStatus(client, { sourceTable: 'special_marriage_licence_requests', sourceId: record.licence_request_id, status: 'Rejected', completed: true, changedByUserId: req2.user.userId, note: reason });
      return { status: 'Rejected' };
    },
  });
}

// ============================================================================================
// CIVIL MARRIAGE SOLEMNISATION BOOKING — a calendar booking (Requested -> Confirmed ->
// Completed/Cancelled), not a document approval. Shares the review fields for consistency
// but has its own action set (confirm/complete/cancel) instead of approve/reject.
// ============================================================================================

/** POST /api/home-affairs/marriage-solemnisation  body: { spouse1Name, spouse2Name, officeId, requestedDate, requestedTime } */
async function requestSolemnisationBooking(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to book a solemnisation.' });
    const { spouse1Name, spouse2Name, officeId, requestedDate, requestedTime } = req.body;
    if (!spouse1Name || !spouse2Name || !officeId || !requestedDate) {
      return res.status(400).json({ error: 'spouse1Name, spouse2Name, officeId and requestedDate are required.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const bookingReference = generateReference('MSB');
      const { rows } = await client.query(
        `INSERT INTO marriage_solemnisation_bookings (citizen_id, spouse1_name, spouse2_name, office_id, requested_date, requested_time, booking_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.citizenId, spouse1Name, spouse2Name, officeId, requestedDate, requestedTime || null, bookingReference]
      );
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Civil Marriage Solemnisation',
        referenceNumber: bookingReference, sourceTable: 'marriage_solemnisation_bookings', sourceId: rows[0].booking_id, status: 'Requested',
      });
      await client.query('COMMIT');
      res.status(201).json({ booking: rows[0] });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } catch (err) { next(err); }
}

async function listSolemnisationBookings(req, res, next) {
  try {
    if (isOfficer(req)) {
      const { rows } = await db.query(
        `SELECT b.*, c.first_name, c.last_name, o.name AS office_name FROM marriage_solemnisation_bookings b
         JOIN citizens c ON c.citizen_id = b.citizen_id LEFT JOIN offices o ON o.office_id = b.office_id
         ORDER BY b.requested_at DESC`
      );
      return res.json({ bookings: rows });
    }
    if (!req.user.citizenId) return res.json({ bookings: [] });
    const { rows } = await db.query(
      `SELECT b.*, o.name AS office_name FROM marriage_solemnisation_bookings b LEFT JOIN offices o ON o.office_id = b.office_id
       WHERE b.citizen_id = $1 ORDER BY b.requested_at DESC`,
      [req.user.citizenId]
    );
    res.json({ bookings: rows });
  } catch (err) { next(err); }
}

async function getSolemnisationBooking(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT b.*, c.first_name, c.last_name, o.name AS office_name, d.name AS office_district,
              m.full_name AS marriage_officer_name, m.officiant_type AS marriage_officer_type
       FROM marriage_solemnisation_bookings b
       JOIN citizens c ON c.citizen_id = b.citizen_id
       LEFT JOIN offices o ON o.office_id = b.office_id
       LEFT JOIN districts d ON d.district_id = o.district_id
       LEFT JOIN marriage_officer_registrations m ON m.marriage_officer_registration_id = b.marriage_officer_registration_id
       WHERE b.booking_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Booking not found.' });
    const record = rows[0];
    if (!isOfficer(req) && record.citizen_id !== req.user.citizenId) return res.status(403).json({ error: 'You do not have access to this booking.' });
    res.json({ booking: record });
  } catch (err) { next(err); }
}

const transitionSolemnisation = buildTransition({ table: 'marriage_solemnisation_bookings', idColumn: 'booking_id', notFoundMessage: 'Booking not found.' });

function requestInformationSolemnisation(req, res, next) {
  const { reason } = req.body;
  return transitionSolemnisation(req, res, next, {
    from: ['Requested'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE marriage_solemnisation_bookings SET status = 'Additional Information Required', updated_at = NOW() WHERE booking_id = $1`, [record.booking_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_solemnisation_bookings', sourceId: record.booking_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.booking_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

function resubmitSolemnisation(req, res, next) {
  const { spouse1Name, spouse2Name, officeId, requestedDate, requestedTime } = req.body;
  return transitionSolemnisation(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Requested', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!spouse1Name || !spouse2Name || !officeId || !requestedDate) throw Object.assign(new Error('spouse1Name, spouse2Name, officeId and requestedDate are required.'), { status: 400 });
      await client.query(
        `UPDATE marriage_solemnisation_bookings SET status = 'Requested', rejection_reason = NULL,
            spouse1_name = $1, spouse2_name = $2, office_id = $3, requested_date = $4, requested_time = $5, updated_at = NOW()
         WHERE booking_id = $6`,
        [spouse1Name, spouse2Name, officeId, requestedDate, requestedTime || null, record.booking_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'marriage_solemnisation_bookings', sourceId: record.booking_id, status: 'Requested', note: 'Citizen resubmitted.' });
      return { status: 'Requested' };
    },
  });
}

/** POST /:id/confirm  body: { confirmedDate, confirmedTime, marriageOfficerRegistrationId } */
function confirmSolemnisation(req, res, next) {
  const { confirmedDate, confirmedTime, marriageOfficerRegistrationId } = req.body;
  return transitionSolemnisation(req, res, next, {
    from: ['Requested'], to: 'Confirmed',
    sideEffect: async (client, record, req2) => {
      await client.query(
        `UPDATE marriage_solemnisation_bookings SET status = 'Confirmed', confirmed_date = $1, confirmed_time = $2, marriage_officer_registration_id = $3,
            reviewed_by_user_id = $4, reviewed_at = NOW(), updated_at = NOW() WHERE booking_id = $5`,
        [confirmedDate || record.requested_date, confirmedTime || record.requested_time, marriageOfficerRegistrationId || null, req2.user.userId, record.booking_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'marriage_solemnisation_bookings', sourceId: record.booking_id, status: 'Confirmed', changedByUserId: req2.user.userId });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Solemnisation booking confirmed', message: `Reference ${record.booking_reference}.`, type: 'Status Change' });
      return { status: 'Confirmed' };
    },
  });
}

/** POST /:id/complete — officer marks the ceremony as having taken place. */
function completeSolemnisation(req, res, next) {
  return transitionSolemnisation(req, res, next, {
    from: ['Confirmed'], to: 'Completed',
    sideEffect: async (client, record, req2) => {
      await client.query(`UPDATE marriage_solemnisation_bookings SET status = 'Completed', updated_at = NOW() WHERE booking_id = $1`, [record.booking_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_solemnisation_bookings', sourceId: record.booking_id, status: 'Completed', completed: true, changedByUserId: req2.user.userId });
      await recordAudit({ userId: req2.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'SOLEMNISATION_COMPLETED', targetType: 'marriage_solemnisation_booking', targetId: record.booking_id });
      return { status: 'Completed' };
    },
  });
}

/** POST /:id/cancel — citizen (owner) or officer. */
function cancelSolemnisation(req, res, next) {
  return transitionSolemnisation(req, res, next, {
    from: ['Requested', 'Confirmed', 'Additional Information Required'], to: 'Cancelled', allowOwner: true,
    sideEffect: async (client, record) => {
      await client.query(`UPDATE marriage_solemnisation_bookings SET status = 'Cancelled', updated_at = NOW() WHERE booking_id = $1`, [record.booking_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_solemnisation_bookings', sourceId: record.booking_id, status: 'Cancelled', completed: true });
      return { status: 'Cancelled' };
    },
  });
}

function rejectSolemnisation(req, res, next) {
  const { reason } = req.body;
  return transitionSolemnisation(req, res, next, {
    from: ['Requested', 'Additional Information Required'], to: 'Rejected',
    sideEffect: async (client, record, req2) => {
      if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
      await client.query(`UPDATE marriage_solemnisation_bookings SET status = 'Rejected', rejection_reason = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE booking_id = $3`, [reason, req2.user.userId, record.booking_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_solemnisation_bookings', sourceId: record.booking_id, status: 'Rejected', completed: true, changedByUserId: req2.user.userId, note: reason });
      return { status: 'Rejected' };
    },
  });
}

// ============================================================================================
// REGISTRATION OF MARRIAGE OFFICERS — internal registry, officer/admin only, no citizen
// applicant and no entry in the generic applications index.
// ============================================================================================

/** POST /api/home-affairs/marriage-officers  body: { fullName, officiantType, authorityOrDenomination, districtId, notes } */
async function createMarriageOfficer(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { fullName, officiantType, authorityOrDenomination, districtId, notes } = req.body;
    if (!fullName || !officiantType) return res.status(400).json({ error: 'fullName and officiantType are required.' });
    const licenceNumber = generateReference('MOR');
    const { rows } = await db.query(
      `INSERT INTO marriage_officer_registrations (full_name, officiant_type, authority_or_denomination, district_id, licence_number, notes, registered_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [fullName, officiantType, authorityOrDenomination || null, districtId || null, licenceNumber, notes || null, req.user.userId]
    );
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'MARRIAGE_OFFICER_REGISTERED', targetType: 'marriage_officer_registration', targetId: rows[0].marriage_officer_registration_id });
    res.status(201).json({ marriageOfficer: rows[0] });
  } catch (err) { next(err); }
}

async function listMarriageOfficers(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { status, districtId } = req.query;
    const { rows } = await db.query(
      `SELECT m.*, d.name AS district_name FROM marriage_officer_registrations m
       LEFT JOIN districts d ON d.district_id = m.district_id
       WHERE ($1::text IS NULL OR m.status = $1) AND ($2::int IS NULL OR m.district_id = $2)
       ORDER BY m.registered_at DESC`,
      [status || null, districtId || null]
    );
    res.json({ marriageOfficers: rows });
  } catch (err) { next(err); }
}

async function getMarriageOfficer(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { rows } = await db.query(
      `SELECT m.*, d.name AS district_name FROM marriage_officer_registrations m
       LEFT JOIN districts d ON d.district_id = m.district_id WHERE m.marriage_officer_registration_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Marriage officer registration not found.' });
    res.json({ marriageOfficer: rows[0] });
  } catch (err) { next(err); }
}

/** POST /api/home-affairs/marriage-officers/:id/status  body: { status: 'Registered'|'Suspended'|'Revoked', notes } */
async function updateMarriageOfficerStatus(req, res, next) {
  try {
    if (!isOfficer(req)) return res.status(403).json({ error: 'Officer only.' });
    const { status, notes } = req.body;
    if (!['Registered', 'Suspended', 'Revoked'].includes(status)) return res.status(400).json({ error: "status must be 'Registered', 'Suspended' or 'Revoked'." });
    const { rows } = await db.query(
      `UPDATE marriage_officer_registrations SET status = $1, notes = COALESCE($2, notes),
          status_changed_by_user_id = $3, status_changed_at = NOW(), updated_at = NOW()
       WHERE marriage_officer_registration_id = $4 RETURNING *`,
      [status, notes || null, req.user.userId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Marriage officer registration not found.' });
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: `MARRIAGE_OFFICER_${status.toUpperCase()}`, targetType: 'marriage_officer_registration', targetId: Number(req.params.id) });
    res.json({ marriageOfficer: rows[0] });
  } catch (err) { next(err); }
}

// ============================================================================================
// IDENTITY ENROLMENT FOR NON-CITIZENS / REFUGEES — keyed on the logged-in user's account
// (users.user_id), not a citizens row. See the file header comment for why this does not
// use buildTransition or the generic applications index.
// ============================================================================================

const FOREIGN_ID_OFFICER_ROLES = OFFICER_ROLES;

/** POST /api/home-affairs/foreign-identity */
async function applyForeignIdentity(req, res, next) {
  try {
    const {
      fullName, dateOfBirth, sex, nationality, travelDocumentType, travelDocumentNumber, immigrationStatus,
      photoReference, leftHandBiometricReference, rightHandBiometricReference,
    } = req.body;
    if (!fullName || !dateOfBirth || !sex || !nationality || !travelDocumentType || !travelDocumentNumber || !immigrationStatus) {
      return res.status(400).json({ error: 'fullName, dateOfBirth, sex, nationality, travelDocumentType, travelDocumentNumber and immigrationStatus are required.' });
    }
    if (!leftHandBiometricReference || !rightHandBiometricReference) {
      return res.status(400).json({ error: 'A biometric scan of both the left and right hand is required.' });
    }
    const { rows: existing } = await db.query(
      `SELECT 1 FROM foreign_identity_enrolments WHERE applicant_user_id = $1 AND status NOT IN ('Rejected')`,
      [req.user.userId]
    );
    if (existing.length > 0) return res.status(409).json({ error: 'You already have an identity enrolment in progress.' });

    const enrolmentReference = generateReference('FID');
    const { rows } = await db.query(
      `INSERT INTO foreign_identity_enrolments
          (applicant_user_id, full_name, date_of_birth, sex, nationality, travel_document_type, travel_document_number,
           immigration_status, photo_reference, biometric_reference_left, biometric_reference_right, enrolment_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.user.userId, fullName, dateOfBirth, sex, nationality, travelDocumentType, travelDocumentNumber,
        immigrationStatus, photoReference || null, leftHandBiometricReference, rightHandBiometricReference, enrolmentReference]
    );
    await createNotification({ userId: req.user.userId, title: 'Identity enrolment submitted', message: `Reference ${enrolmentReference}.`, type: 'Application Submitted' });
    res.status(201).json({ foreignIdentityEnrolment: rows[0] });
  } catch (err) { next(err); }
}

async function listForeignIdentityEnrolments(req, res, next) {
  try {
    if (FOREIGN_ID_OFFICER_ROLES.includes(req.user.roleKey)) {
      const { rows } = await db.query(
        `SELECT f.*, u.email FROM foreign_identity_enrolments f JOIN users u ON u.user_id = f.applicant_user_id ORDER BY f.requested_at DESC`
      );
      return res.json({ foreignIdentityEnrolments: rows });
    }
    const { rows } = await db.query('SELECT * FROM foreign_identity_enrolments WHERE applicant_user_id = $1 ORDER BY requested_at DESC', [req.user.userId]);
    res.json({ foreignIdentityEnrolments: rows });
  } catch (err) { next(err); }
}

async function getForeignIdentityEnrolment(req, res, next) {
  try {
    const { rows } = await db.query('SELECT * FROM foreign_identity_enrolments WHERE foreign_identity_enrolment_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Identity enrolment not found.' });
    const record = rows[0];
    const isOfficerUser = FOREIGN_ID_OFFICER_ROLES.includes(req.user.roleKey);
    if (!isOfficerUser && record.applicant_user_id !== req.user.userId) return res.status(403).json({ error: 'You do not have access to this record.' });
    res.json({ foreignIdentityEnrolment: record });
  } catch (err) { next(err); }
}

/** Bespoke transition helper for this one service — ownership is checked against
 *  applicant_user_id/req.user.userId rather than citizen_id/req.user.citizenId, so it cannot
 *  reuse utils/workflow.js's buildTransition() as written. */
async function transitionForeignIdentity(req, res, next, { from, to, allowOwner = false, sideEffect }) {
  try {
    const isOfficerUser = FOREIGN_ID_OFFICER_ROLES.includes(req.user.roleKey);
    if (!isOfficerUser && !allowOwner) return res.status(403).json({ error: 'Officer only.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM foreign_identity_enrolments WHERE foreign_identity_enrolment_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Identity enrolment not found.' }); }
      const record = rows[0];
      if (!isOfficerUser && record.applicant_user_id !== req.user.userId) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Not your enrolment.' });
      }
      if (Array.isArray(from) ? !from.includes(record.status) : record.status !== from) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move from '${record.status}' to '${to}'.` });
      }
      const result = await (sideEffect ? sideEffect(client, record, req) : Promise.resolve({}));
      await client.query('COMMIT');
      res.json({ foreignIdentityEnrolmentId: record.foreign_identity_enrolment_id, status: (result && result.status) || to, ...((result && result.extra) || {}) });
    } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  } catch (err) { next(err); }
}

function startReviewForeignIdentity(req, res, next) {
  return transitionForeignIdentity(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE foreign_identity_enrolments SET status = 'Under Review', updated_at = NOW() WHERE foreign_identity_enrolment_id = $1`, [record.foreign_identity_enrolment_id]);
      return { status: 'Under Review' };
    },
  });
}

function requestInformationForeignIdentity(req, res, next) {
  const { reason } = req.body;
  return transitionForeignIdentity(req, res, next, {
    from: ['Under Review'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE foreign_identity_enrolments SET status = 'Additional Information Required', updated_at = NOW() WHERE foreign_identity_enrolment_id = $1`, [record.foreign_identity_enrolment_id]);
      await createNotification({ userId: record.applicant_user_id, title: 'Additional information required', message: `Reference ${record.enrolment_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

function resubmitForeignIdentity(req, res, next) {
  const { fullName, nationality, travelDocumentType, travelDocumentNumber, immigrationStatus, photoReference, leftHandBiometricReference, rightHandBiometricReference } = req.body;
  return transitionForeignIdentity(req, res, next, {
    from: ['Additional Information Required', 'Rejected'], to: 'Under Review', allowOwner: true,
    sideEffect: async (client, record) => {
      if (!fullName || !nationality || !travelDocumentType || !travelDocumentNumber || !immigrationStatus || !leftHandBiometricReference || !rightHandBiometricReference) {
        throw Object.assign(new Error('fullName, nationality, travelDocumentType, travelDocumentNumber, immigrationStatus and both biometric scans are required.'), { status: 400 });
      }
      await client.query(
        `UPDATE foreign_identity_enrolments SET status = 'Under Review', rejection_reason = NULL,
            full_name = $1, nationality = $2, travel_document_type = $3, travel_document_number = $4, immigration_status = $5,
            photo_reference = $6, biometric_reference_left = $7, biometric_reference_right = $8, updated_at = NOW()
         WHERE foreign_identity_enrolment_id = $9`,
        [fullName, nationality, travelDocumentType, travelDocumentNumber, immigrationStatus, photoReference || record.photo_reference, leftHandBiometricReference, rightHandBiometricReference, record.foreign_identity_enrolment_id]
      );
      return { status: 'Under Review' };
    },
  });
}

function approveForeignIdentity(req, res, next) {
  return transitionForeignIdentity(req, res, next, {
    from: ['Under Review'], to: 'Approved',
    sideEffect: async (client, record, req2) => {
      const foreignIdNumber = await withUniquePermanentId(record.date_of_birth, async (candidate) => {
        const value = `F${candidate}`;
        await client.query(
          `UPDATE foreign_identity_enrolments SET foreign_id_number = $1, status = 'Approved', reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW()
           WHERE foreign_identity_enrolment_id = $3`,
          [value, req2.user.userId, record.foreign_identity_enrolment_id]
        );
        return value;
      });
      await recordAudit({ userId: req2.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'FOREIGN_IDENTITY_APPROVED', targetType: 'foreign_identity_enrolment', targetId: record.foreign_identity_enrolment_id });
      await createNotification({ userId: record.applicant_user_id, title: 'Identity enrolment approved', message: `Reference ${record.enrolment_reference}. Your identity number is ${foreignIdNumber}.`, type: 'Approval' });
      return { status: 'Approved', extra: { foreignIdNumber } };
    },
  });
}

function rejectForeignIdentity(req, res, next) {
  const { reason } = req.body;
  return transitionForeignIdentity(req, res, next, {
    from: ['Submitted', 'Under Review', 'Additional Information Required'], to: 'Rejected',
    sideEffect: async (client, record, req2) => {
      if (!reason) throw Object.assign(new Error('A rejection reason is required.'), { status: 400 });
      await client.query(`UPDATE foreign_identity_enrolments SET status = 'Rejected', rejection_reason = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE foreign_identity_enrolment_id = $3`, [reason, req2.user.userId, record.foreign_identity_enrolment_id]);
      return { status: 'Rejected' };
    },
  });
}

module.exports = {
  requestBirthCertificateReissue, listBirthCertificateReissues, getBirthCertificateReissue,
  startReviewReissue, requestInformationReissue, resubmitReissue, approveReissue, rejectReissue,

  requestDeathCertificate, listDeathCertificateRequests, getDeathCertificateRequest,
  startReviewDeathCertRequest, requestInformationDeathCertRequest, resubmitDeathCertRequest, approveDeathCertRequest, rejectDeathCertRequest,

  requestNameChange, listNameChangeRequests, getNameChangeRequest,
  startReviewNameChange, requestInformationNameChange, resubmitNameChange, approveNameChange, rejectNameChange,

  requestAdoption, listAdoptions, getAdoption,
  startReviewAdoption, requestInformationAdoption, resubmitAdoption, approveAdoption, rejectAdoption,

  requestBurialOrder, listBurialOrders, getBurialOrder,
  startReviewBurialOrder, requestInformationBurialOrder, resubmitBurialOrder, approveBurialOrder, rejectBurialOrder,

  requestSpecialMarriageLicence, listSpecialMarriageLicences, getSpecialMarriageLicence,
  startReviewSpecialLicence, requestInformationSpecialLicence, resubmitSpecialLicence, approveSpecialLicence, rejectSpecialLicence,

  requestSolemnisationBooking, listSolemnisationBookings, getSolemnisationBooking,
  requestInformationSolemnisation, resubmitSolemnisation, confirmSolemnisation, completeSolemnisation, cancelSolemnisation, rejectSolemnisation,

  createMarriageOfficer, listMarriageOfficers, getMarriageOfficer, updateMarriageOfficerStatus,

  applyForeignIdentity, listForeignIdentityEnrolments, getForeignIdentityEnrolment,
  startReviewForeignIdentity, requestInformationForeignIdentity, resubmitForeignIdentity, approveForeignIdentity, rejectForeignIdentity,
};
