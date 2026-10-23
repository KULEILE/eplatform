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

/** POST /api/home-affairs/birth-certificate-reissue  body: { birthRecordId, reason, details, proofImageReference } */
/**
 * A birth certificate never expires, so there is no "renewal" of one — this is always a REISSUE:
 * a replacement copy of a certificate that was lost, damaged, or never collected. A stated reason
 * alone is not enough — the citizen must also upload proof supporting it (a police report for
 * "Lost", a photo of the damaged certificate for "Damaged", and so on). See migration 060.
 *
 * As of Batch 4 this is fully automatic, like birth-certificate issuance itself — no officer
 * review queue. A Home Affairs officer is only ever involved anywhere in the birth-certificate
 * domain to resolve a disputed parentage confirmation (see listParentageDisputes /
 * resolveParentageDispute in homeAffairs.controller.js) — never for a routine reissue.
 */
async function requestBirthCertificateReissue(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to request a reissue.' });
    const { birthRecordId, reason, details, proofImageReference } = req.body;
    if (!birthRecordId || !reason) return res.status(400).json({ error: 'birthRecordId and reason are required.' });
    if (!proofImageReference) return res.status(400).json({ error: 'Proof supporting your reason for requesting a reissue is required.' });
    const { rows: brRows } = await db.query('SELECT * FROM birth_records WHERE birth_record_id = $1', [birthRecordId]);
    if (brRows.length === 0) return res.status(404).json({ error: 'Birth record not found.' });
    const birthRecord = brRows[0];
    // Reissue is available to the citizen the certificate is ABOUT, or the parent/guardian who
    // originally registered it — same dual-ownership rule used everywhere else in this domain
    // (see getBirthCertificate's isOwner check) — so a parent can reissue a child's certificate
    // on the child's behalf, not only the child themselves once they have their own account.
    if (birthRecord.citizen_id !== req.user.citizenId && birthRecord.parent_citizen_id !== req.user.citizenId) {
      return res.status(403).json({ error: 'This birth record is not linked to your identity.' });
    }
    if (birthRecord.registration_status !== 'Approved') return res.status(409).json({ error: 'No certificate has been issued for this birth registration yet.' });

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const reissueReference = generateReference('BCR');
      const { rows } = await client.query(
        `INSERT INTO birth_certificate_reissue_requests (citizen_id, birth_record_id, reason, details, proof_image_reference, reissue_reference, status, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'Approved',NOW()) RETURNING *`,
        [req.user.citizenId, birthRecordId, reason, details || null, proofImageReference, reissueReference]
      );
      // Re-opens the existing certificate for collection, same as a brand-new one — no officer
      // approval step to wait for any more.
      await client.query(`UPDATE birth_certificates SET status = 'Ready for Collection', ready_for_collection_at = NOW(), updated_at = NOW() WHERE birth_record_id = $1`, [birthRecordId]);
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Birth Certificate Reissue',
        referenceNumber: reissueReference, sourceTable: 'birth_certificate_reissue_requests', sourceId: rows[0].reissue_request_id, status: 'Approved',
      });
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: 'Birth certificate reissue approved',
        message: `Reference ${reissueReference}. Your certificate is ready for collection.`, type: 'Approval',
      });
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

/**
 * GET /api/home-affairs/my-birth-certificates — feeds the new "Birth Certificate" section page
 * and its reissue action: the citizen picks a certificate from a real list (their own, or any
 * child's they are a verified parent or registering guardian of) instead of typing a raw
 * internal birth record ID they have no natural way to know.
 */
async function listMyBirthCertificates(req, res, next) {
  try {
    if (!req.user.citizenId) return res.json({ own: null, children: [] });
    const { rows: ownRows } = await db.query(
      `SELECT bc.birth_certificate_id, bc.certificate_number, bc.status, bc.birth_record_id,
              c.first_name, c.middle_name, c.last_name
       FROM birth_certificates bc JOIN citizens c ON c.citizen_id = bc.citizen_id
       WHERE bc.citizen_id = $1`,
      [req.user.citizenId]
    );
    const { rows: childRows } = await db.query(
      `SELECT bc.birth_certificate_id, bc.certificate_number, bc.status, bc.birth_record_id,
              c.first_name, c.middle_name, c.last_name
       FROM birth_records br
       JOIN birth_certificates bc ON bc.birth_record_id = br.birth_record_id
       JOIN citizens c ON c.citizen_id = br.citizen_id
       WHERE (br.parent_citizen_id = $1 OR br.father_citizen_id = $1 OR br.mother_citizen_id = $1)
         AND br.citizen_id IS NOT NULL AND br.citizen_id != $1
       ORDER BY c.date_of_birth DESC`,
      [req.user.citizenId]
    );
    res.json({ own: ownRows[0] || null, children: childRows });
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

// The officer-review transition pipeline that used to exist here (startReviewReissue,
// requestInformationReissue, resubmitReissue, approveReissue, rejectReissue) was removed in
// Batch 4 — requestBirthCertificateReissue above now auto-approves every request on submission,
// so nothing ever reaches 'Submitted' or 'Under Review' for an officer to act on any more. Any
// pre-Batch-4 request already sitting in one of those states keeps whatever status it has; there
// is simply no endpoint left to move it, which is fine since this file's own migration history
// shows no real reissue request was ever left mid-review in this prototype's demo data.

// ============================================================================================
// DEATH CERTIFICATE ISSUANCE — REMOVED. A death certificate is now generated automatically the
// moment a Home Affairs officer approves the death registration itself (see approveDeath in
// homeAffairs.controller.js and migration 058) — there is no longer a separate request to file
// or a second approval to wait for. The old death_certificate_requests table and any
// certificate numbers it already issued are left untouched in the database; only this
// now-redundant request-and-approve workflow has been removed.
// ============================================================================================

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
  requestBirthCertificateReissue, listBirthCertificateReissues, getBirthCertificateReissue, listMyBirthCertificates,
  requestNameChange, listNameChangeRequests, getNameChangeRequest,
  startReviewNameChange, requestInformationNameChange, resubmitNameChange, approveNameChange, rejectNameChange,

  requestAdoption, listAdoptions, getAdoption,
  startReviewAdoption, requestInformationAdoption, resubmitAdoption, approveAdoption, rejectAdoption,

  requestSolemnisationBooking, listSolemnisationBookings, getSolemnisationBooking,
  requestInformationSolemnisation, resubmitSolemnisation, confirmSolemnisation, completeSolemnisation, cancelSolemnisation, rejectSolemnisation,

  createMarriageOfficer, listMarriageOfficers, getMarriageOfficer, updateMarriageOfficerStatus,

  applyForeignIdentity, listForeignIdentityEnrolments, getForeignIdentityEnrolment,
  startReviewForeignIdentity, requestInformationForeignIdentity, resubmitForeignIdentity, approveForeignIdentity, rejectForeignIdentity,
};
