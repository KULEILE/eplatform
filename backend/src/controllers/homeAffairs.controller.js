const db = require('../config/db');
const { withUniquePermanentId } = require('../utils/idGenerator');
const { generateReference } = require('../utils/referenceGenerator');
const { indexApplication, syncApplicationStatus, getDepartmentId } = require('../utils/lookup');
const { createNotification } = require('../utils/notify');
const { recordAudit } = require('../utils/audit');

// ============================================================================================
// BIRTH REGISTRATION
//
// registration_status flow (see migration 005):
//   Draft -> Submitted -> Under Review -> [Information Required -> Under Review]
//         -> Verification in Progress -> Verified -> Approved
//                                                  \-> Rejected (from any non-terminal state)
//
// A citizen identity + permanent_identity_number + birth certificate are created ONLY on
// approve(). Nothing before that point creates a citizen record for the child.
// ============================================================================================

/** POST /api/home-affairs/birth-registration — parent/guardian submits (citizen only). */
async function createBirthRegistration(req, res, next) {
  try {
    if (!req.user.citizenId) {
      return res.status(403).json({ error: 'A verified identity is required to register a birth. Provisional accounts cannot yet submit this application.' });
    }
    const {
      childFirstName, childMiddleName, childLastName, dateOfBirth, placeOfBirth, sex, preferredOfficeId,
      // The real Kingdom of Lesotho birth certificate records the parents and the informant who
      // reported the birth — see migration 025. All optional here (an officer can still request
      // this information later via "request information") so older/partial submissions don't fail.
      fatherName, fatherNationality, motherName, motherMaidenSurname, motherNationality, motherResidence,
      informantName, informantCapacity, informantResidence,
    } = req.body;
    if (!childFirstName || !childLastName || !dateOfBirth || !placeOfBirth || !sex) {
      return res.status(400).json({ error: 'childFirstName, childLastName, dateOfBirth, placeOfBirth and sex are required.' });
    }
    if (!preferredOfficeId) {
      return res.status(400).json({ error: 'preferredOfficeId is required — choose the branch where you will collect the certificate.' });
    }
    const referenceNumber = generateReference('BR');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO birth_records (parent_citizen_id, registration_reference, child_first_name,
            child_middle_name, child_last_name, date_of_birth, place_of_birth, sex,
            registration_status, submitted_at, preferred_office_id,
            father_name, father_nationality, mother_name, mother_maiden_surname, mother_nationality,
            mother_residence, informant_name, informant_capacity, informant_residence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Submitted', NOW(), $9, $10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING birth_record_id`,
        [req.user.citizenId, referenceNumber, childFirstName, childMiddleName || null, childLastName, dateOfBirth, placeOfBirth, sex, preferredOfficeId,
         fatherName || null, fatherNationality || 'Mosotho', motherName || null, motherMaidenSurname || null, motherNationality || 'Mosotho',
         motherResidence || null, informantName || null, informantCapacity || null, informantResidence || null]
      );
      const birthRecordId = rows[0].birth_record_id;
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Birth Registration',
        referenceNumber, sourceTable: 'birth_records', sourceId: birthRecordId, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: 'Birth registration submitted',
        message: `Your birth registration application ${referenceNumber} for ${childFirstName} ${childLastName} has been submitted and is awaiting review.`,
        type: 'Application Submitted',
      });
      res.status(201).json({ birthRecordId, referenceNumber, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** GET /api/home-affairs/birth-registration — citizen: own applications. Officer: queue (optionally ?status=). */
async function listBirthRegistrations(req, res, next) {
  try {
    if (req.user.roleKey === 'home_affairs_officer' || req.user.roleKey === 'system_administrator') {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT br.*, c.first_name AS parent_first_name, c.last_name AS parent_last_name,
                c.permanent_identity_number AS parent_permanent_identity_number
         FROM birth_records br JOIN citizens c ON c.citizen_id = br.parent_citizen_id
         WHERE $1::text IS NULL OR br.registration_status = $1
         ORDER BY br.submitted_at DESC NULLS LAST`,
        [status || null]
      );
      return res.json({ birthRegistrations: rows });
    }
    if (!req.user.citizenId) return res.json({ birthRegistrations: [] });
    const { rows } = await db.query(
      `SELECT * FROM birth_records WHERE parent_citizen_id = $1 ORDER BY submitted_at DESC NULLS LAST`,
      [req.user.citizenId]
    );
    res.json({ birthRegistrations: rows });
  } catch (err) {
    next(err);
  }
}

/** GET /api/home-affairs/birth-registration/:id */
async function getBirthRegistration(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT br.*, bc.birth_certificate_id, bc.certificate_number, bc.status AS certificate_status,
              o.name AS preferred_office_name, dist.name AS preferred_office_district
       FROM birth_records br LEFT JOIN birth_certificates bc ON bc.birth_record_id = br.birth_record_id
       LEFT JOIN offices o ON o.office_id = br.preferred_office_id
       LEFT JOIN districts dist ON dist.district_id = o.district_id
       WHERE br.birth_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Birth registration not found.' });
    const record = rows[0];
    const isOwner = req.user.citizenId && record.parent_citizen_id === req.user.citizenId;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this application.' });
    res.json({ birthRegistration: record });
  } catch (err) {
    next(err);
  }
}

async function transitionBirthRegistration(req, res, next, { from, to, sideEffect }) {
  try {
    if (req.user.roleKey !== 'home_affairs_officer' && req.user.roleKey !== 'system_administrator') {
      return res.status(403).json({ error: 'Only Home Affairs officers can perform this action.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM birth_records WHERE birth_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Birth registration not found.' }); }
      const record = rows[0];
      if (Array.isArray(from) ? !from.includes(record.registration_status) : record.registration_status !== from) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move from '${record.registration_status}' to '${to}'.` });
      }
      const result = await (sideEffect ? sideEffect(client, record, req) : Promise.resolve({}));
      await client.query('COMMIT');
      res.json({ birthRecordId: record.birth_record_id, status: result.status || to, ...result.extra });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** POST /:id/start-review — Submitted -> Under Review */
function startReviewBirthRegistration(req, res, next) {
  return transitionBirthRegistration(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE birth_records SET registration_status = 'Under Review', handling_officer_id = $1, updated_at = NOW() WHERE birth_record_id = $2`, [req.user.userId, record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

/** POST /:id/request-information  body: { reason } — Under Review -> Information Required */
function requestInformationBirthRegistration(req, res, next) {
  const { reason } = req.body;
  return transitionBirthRegistration(req, res, next, {
    from: ['Under Review', 'Verification in Progress'], to: 'Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required when requesting additional information.'), { status: 400 });
      await client.query(`UPDATE birth_records SET registration_status = 'Information Required', updated_at = NOW() WHERE birth_record_id = $1`, [record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Information Required' });
      await createNotification({
        userId: (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.parent_citizen_id])).rows[0]?.user_id,
        title: 'Additional information required', message: `Reference ${record.registration_reference}: ${reason}`, type: 'Missing Information',
      });
      return { status: 'Information Required' };
    },
  });
}

/** POST /:id/resubmit — parent resubmits after Information Required -> Under Review */
function resubmitBirthRegistration(req, res, next) {
  return transitionBirthRegistration(req, res, next, {
    from: 'Information Required', to: 'Under Review',
    sideEffect: async (client, record) => {
      if (record.parent_citizen_id !== req.user.citizenId) throw Object.assign(new Error('Not your application.'), { status: 403 });
      await client.query(`UPDATE birth_records SET registration_status = 'Under Review', updated_at = NOW() WHERE birth_record_id = $1`, [record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

/** POST /:id/verify — Under Review -> Verification in Progress */
function verifyBirthRegistration(req, res, next) {
  return transitionBirthRegistration(req, res, next, {
    from: 'Under Review', to: 'Verification in Progress',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE birth_records SET registration_status = 'Verification in Progress', handling_officer_id = $1, updated_at = NOW() WHERE birth_record_id = $2`, [req.user.userId, record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Verification in Progress' });
      return { status: 'Verification in Progress' };
    },
  });
}

/** POST /:id/confirm-verification — Verification in Progress -> Verified */
function confirmVerificationBirthRegistration(req, res, next) {
  return transitionBirthRegistration(req, res, next, {
    from: 'Verification in Progress', to: 'Verified',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE birth_records SET registration_status = 'Verified', verified_at = NOW(), updated_at = NOW() WHERE birth_record_id = $1`, [record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Verified' });
      return { status: 'Verified' };
    },
  });
}

/**
 * POST /:id/approve — Verified -> Approved.
 * THIS is the only place a child citizen identity + permanent_identity_number + birth
 * certificate get created. Everything before this point is workflow only.
 */
function approveBirthRegistration(req, res, next) {
  return transitionBirthRegistration(req, res, next, {
    from: 'Verified', to: 'Approved',
    sideEffect: async (client, record) => {
      const citizenId = await withUniquePermanentId(record.date_of_birth, async (candidatePin) => {
        const { rows } = await client.query(
          `INSERT INTO citizens (permanent_identity_number, first_name, middle_name, last_name,
              date_of_birth, place_of_birth, sex, citizenship_status, identity_verification_status,
              parent_citizen_id, is_demo_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'Citizen','Verified',$8,TRUE) RETURNING citizen_id`,
          [candidatePin, record.child_first_name, record.child_middle_name, record.child_last_name,
           record.date_of_birth, record.place_of_birth, record.sex, record.parent_citizen_id]
        );
        return rows[0].citizen_id;
      });

      await client.query(
        `UPDATE birth_records SET registration_status = 'Approved', citizen_id = $1, approved_at = NOW(), updated_at = NOW() WHERE birth_record_id = $2`,
        [citizenId, record.birth_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Approved', completed: false });

      const certificateNumber = generateReference('BC');
      // Carries over the branch the citizen chose when they applied, so the certificate already
      // shows its intended collection point the moment it exists — an officer can still change
      // it later at the Ready for Collection step if that branch can't fulfil it.
      const { rows: certRows } = await client.query(
        `INSERT INTO birth_certificates (citizen_id, birth_record_id, certificate_number, issue_date, status, collection_office_id)
         VALUES ($1,$2,$3, CURRENT_DATE, 'Certificate Generated', $4) RETURNING birth_certificate_id`,
        [citizenId, record.birth_record_id, certificateNumber, record.preferred_office_id]
      );

      const parentUser = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.parent_citizen_id])).rows[0];
      if (parentUser) {
        await createNotification({
          userId: parentUser.user_id, title: 'Birth registration approved',
          message: `Birth registration ${record.registration_reference} has been approved. A birth certificate (${certificateNumber}) has been generated and is being prepared for collection.`,
          type: 'Approval',
        });
      }
      await recordAudit({
        userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'),
        action: 'BIRTH_REGISTRATION_APPROVED', targetType: 'birth_record', targetId: record.birth_record_id,
        metadata: { citizenId, certificateNumber },
      });

      return { status: 'Approved', extra: { citizenId, birthCertificateId: certRows[0].birth_certificate_id, certificateNumber } };
    },
  });
}

/** POST /:id/reject  body: { reason } */
function rejectBirthRegistration(req, res, next) {
  const { reason } = req.body;
  return transitionBirthRegistration(req, res, next, {
    from: ['Submitted', 'Under Review', 'Information Required', 'Verification in Progress', 'Verified'],
    to: 'Rejected',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required to reject an application.'), { status: 400 });
      await client.query(`UPDATE birth_records SET registration_status = 'Rejected', rejection_reason = $1, updated_at = NOW() WHERE birth_record_id = $2`, [reason, record.birth_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'birth_records', sourceId: record.birth_record_id, status: 'Rejected', completed: true });
      const parentUser = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.parent_citizen_id])).rows[0];
      if (parentUser) {
        await createNotification({ userId: parentUser.user_id, title: 'Birth registration rejected', message: `Reference ${record.registration_reference}: ${reason}`, type: 'Rejection' });
      }
      return { status: 'Rejected' };
    },
  });
}

// ============================================================================================
// BIRTH CERTIFICATE
// ============================================================================================

/** GET /api/home-affairs/birth-certificate/:id */
async function getBirthCertificate(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT bc.*, c.first_name, c.middle_name, c.last_name, c.date_of_birth, c.place_of_birth,
              c.sex, c.permanent_identity_number, o.name AS collection_office_name,
              p.first_name AS parent_first_name, p.last_name AS parent_last_name,
              br.father_name, br.father_nationality, br.mother_name, br.mother_maiden_surname,
              br.mother_nationality, br.mother_residence, br.informant_name, br.informant_capacity,
              br.informant_residence, br.approved_at AS date_of_registration
       FROM birth_certificates bc
       JOIN citizens c ON c.citizen_id = bc.citizen_id
       JOIN birth_records br ON br.birth_record_id = bc.birth_record_id
       JOIN citizens p ON p.citizen_id = br.parent_citizen_id
       LEFT JOIN offices o ON o.office_id = bc.collection_office_id
       WHERE bc.birth_certificate_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Birth certificate not found.' });
    const cert = rows[0];
    const isOwnerParent = req.user.citizenId && cert.parent_first_name && (
      (await db.query('SELECT parent_citizen_id FROM birth_records WHERE birth_record_id = $1', [cert.birth_record_id])).rows[0].parent_citizen_id === req.user.citizenId
    );
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwnerParent && !isOfficer) return res.status(403).json({ error: 'You do not have access to this certificate.' });
    res.json({ birthCertificate: cert });
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/birth-certificate/:id/ready-for-collection (officer) */
async function markCertificateReadyForCollection(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { officeId } = req.body;
    // COALESCE: an officer can override the branch here, but if they don't, the office already
    // set (from the citizen's choice at application time) is kept rather than cleared.
    const { rows } = await db.query(
      `UPDATE birth_certificates SET status = 'Ready for Collection', collection_office_id = COALESCE($1, collection_office_id), ready_for_collection_at = NOW(), updated_at = NOW()
       WHERE birth_certificate_id = $2 AND status = 'Certificate Generated' RETURNING *`,
      [officeId || null, req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Certificate is not in a state that can move to Ready for Collection.' });
    res.json({ birthCertificate: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/birth-certificate/:id/collect (officer confirms physical collection) */
async function collectBirthCertificate(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { rows } = await db.query(
      `UPDATE birth_certificates SET status = 'Collected', collected_at = NOW(), updated_at = NOW()
       WHERE birth_certificate_id = $1 AND status = 'Ready for Collection' RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Certificate must be Ready for Collection before it can be marked Collected.' });
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'BIRTH_CERTIFICATE_COLLECTED', targetType: 'birth_certificate', targetId: Number(req.params.id) });
    res.json({ birthCertificate: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ============================================================================================
// NATIONAL ID CARD — reuses the existing permanent identity number. Never generates a new one.
// ============================================================================================

/** POST /api/home-affairs/national-id/apply (citizen, must already have a verified identity) */
async function applyNationalId(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to apply for a National ID card.' });
    const { rows: citizenRows } = await db.query('SELECT * FROM citizens WHERE citizen_id = $1', [req.user.citizenId]);
    const citizen = citizenRows[0];
    const { rows: existing } = await db.query(
      `SELECT 1 FROM national_id_cards WHERE citizen_id = $1 AND production_status NOT IN ('Rejected', 'Collected')`,
      [req.user.citizenId]
    );
    if (existing.length > 0) return res.status(409).json({ error: 'You already have a National ID card application in progress.' });

    const { photoReference, preferredOfficeId } = req.body; // photoReference: simulated capture reference from the frontend
    if (!preferredOfficeId) {
      return res.status(400).json({ error: 'preferredOfficeId is required — choose the branch where you will collect the card.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO national_id_cards (citizen_id, permanent_identity_number, application_date, production_status, photo_reference, preferred_office_id, collection_office_id)
         VALUES ($1,$2, CURRENT_DATE, 'Application Submitted', $3, $4, $4) RETURNING national_id_card_id`,
        [req.user.citizenId, citizen.permanent_identity_number, photoReference || null, preferredOfficeId]
      );
      const nationalIdCardId = rows[0].national_id_card_id;
      const referenceNumber = generateReference('NIDA');
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'National ID Card',
        referenceNumber, sourceTable: 'national_id_cards', sourceId: nationalIdCardId, status: 'Application Submitted',
      });
      await client.query('COMMIT');
      await createNotification({ userId: req.user.userId, title: 'National ID application submitted', message: `Reference ${referenceNumber}. Your existing permanent identity number will be reused — no new number is issued.`, type: 'Application Submitted' });
      res.status(201).json({ nationalIdCardId, referenceNumber, status: 'Application Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

/** GET /api/home-affairs/national-id — citizen: own. Officer: queue. */
async function listNationalId(req, res, next) {
  try {
    if (['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT n.*, c.first_name, c.last_name FROM national_id_cards n JOIN citizens c ON c.citizen_id = n.citizen_id
         WHERE $1::text IS NULL OR n.production_status = $1 ORDER BY n.application_date DESC`,
        [status || null]
      );
      return res.json({ nationalIdCards: rows });
    }
    if (!req.user.citizenId) return res.json({ nationalIdCards: [] });
    const { rows } = await db.query('SELECT * FROM national_id_cards WHERE citizen_id = $1 ORDER BY application_date DESC', [req.user.citizenId]);
    res.json({ nationalIdCards: rows });
  } catch (err) {
    next(err);
  }
}

/** GET /api/home-affairs/national-id/:id */
async function getNationalId(req, res, next) {
  try {
    const { rows } = await db.query(
      // The real National ID card shows the holder's name/DOB/sex and a "place of issue" (the
      // issuing office's district) and expiry date — none of which the card record itself
      // stores, so this pulls them in from citizens and offices/districts. Expiry is a
      // prototype convention (10 years from approval), computed here rather than stored.
      `SELECT n.*, c.first_name, c.middle_name, c.last_name, c.date_of_birth, c.sex, c.citizenship_status,
              o.name AS collection_office_name, d.name AS collection_office_district,
              (n.approval_date + INTERVAL '10 years')::date AS expiry_date
       FROM national_id_cards n
       JOIN citizens c ON c.citizen_id = n.citizen_id
       LEFT JOIN offices o ON o.office_id = n.collection_office_id
       LEFT JOIN districts d ON d.district_id = o.district_id
       WHERE n.national_id_card_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'National ID application not found.' });
    const record = rows[0];
    const isOwner = req.user.citizenId === record.citizen_id;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this application.' });
    res.json({ nationalIdCard: record });
  } catch (err) {
    next(err);
  }
}

const NID_TRANSITIONS = {
  'start-review': { from: 'Application Submitted', to: 'Under Review' },
  'verify': { from: 'Under Review', to: 'Verification in Progress' },
  'confirm-verification': { from: 'Verification in Progress', to: 'Approved', createsCard: false },
  'produce': { from: 'Approved', to: 'Card Production' },
  'ready-for-collection': { from: 'Card Production', to: 'Ready for Collection' },
  'collect': { from: 'Ready for Collection', to: 'Collected' },
};

/** POST /api/home-affairs/national-id/:id/:action (officer state machine) */
async function transitionNationalId(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const action = req.params.action;
    const transition = NID_TRANSITIONS[action];
    if (!transition) return res.status(400).json({ error: `Unknown action: ${action}` });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM national_id_cards WHERE national_id_card_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
      const record = rows[0];
      if (record.production_status !== transition.from) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move from '${record.production_status}' to '${transition.to}'.` });
      }
      let cardNumber = record.card_number;
      if (transition.to === 'Card Production' && !cardNumber) {
        cardNumber = 'NID-' + generateReference('').replace(/^-/, '').replace(/-/g, '');
      }
      const officeId = req.body.officeId || record.collection_office_id;
      await client.query(
        // $1 is cast explicitly everywhere it appears: used both to SET a varchar column and to
        // compare against text literals, Postgres cannot otherwise settle on one type for it
        // ("inconsistent types deduced for parameter $1") and rejects the whole statement.
        `UPDATE national_id_cards SET production_status = $1::varchar, card_number = COALESCE($2, card_number),
            approval_date = CASE WHEN $1::varchar = 'Approved' THEN CURRENT_DATE ELSE approval_date END,
            collection_office_id = CASE WHEN $1::varchar = 'Ready for Collection' THEN $3 ELSE collection_office_id END,
            ready_for_collection_at = CASE WHEN $1::varchar = 'Ready for Collection' THEN NOW() ELSE ready_for_collection_at END,
            collected_at = CASE WHEN $1::varchar = 'Collected' THEN NOW() ELSE collected_at END,
            biometric_status = CASE WHEN $1::varchar = 'Card Production' THEN 'Enrolled' ELSE biometric_status END,
            updated_at = NOW()
         WHERE national_id_card_id = $4`,
        [transition.to, cardNumber, officeId, record.national_id_card_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'national_id_cards', sourceId: record.national_id_card_id, status: transition.to, completed: transition.to === 'Collected' });
      await client.query('COMMIT');

      const userRow = (await db.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.citizen_id])).rows[0];
      if (userRow) {
        const messages = {
          'Under Review': 'Your National ID application is now under review.',
          'Verification in Progress': 'Your identity is being verified against your Home Affairs record.',
          'Approved': 'Your National ID application has been approved.',
          'Card Production': 'Your National ID card is being produced.',
          'Ready for Collection': 'Your National ID card is ready for collection.',
          'Collected': 'Your National ID card has been marked as collected.',
        };
        await createNotification({
          userId: userRow.user_id, title: `National ID: ${transition.to}`, message: messages[transition.to] || `Status updated to ${transition.to}.`,
          type: transition.to === 'Ready for Collection' ? 'Ready for Collection' : transition.to === 'Approved' ? 'Approval' : 'Status Change',
        });
      }
      res.json({ nationalIdCardId: record.national_id_card_id, status: transition.to, cardNumber });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

// ============================================================================================
// CORRECTIONS (FR12) & DEATH REGISTRATION
// ============================================================================================

/** POST /api/home-affairs/correction  body: { fieldName, currentValue, requestedValue, reason } */
async function submitCorrection(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to submit a correction request.' });
    const { fieldName, currentValue, requestedValue, reason } = req.body;
    if (!fieldName || !requestedValue || !reason) return res.status(400).json({ error: 'fieldName, requestedValue and reason are required.' });
    const departmentId = await getDepartmentId('home_affairs');
    const { rows } = await db.query(
      `INSERT INTO corrections (citizen_id, requested_by_user_id, department_id, field_name, current_value, requested_value, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.citizenId, req.user.userId, departmentId, fieldName, currentValue || null, requestedValue, reason]
    );
    res.status(201).json({ correction: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** GET /api/home-affairs/correction — officer queue, or citizen's own */
async function listCorrections(req, res, next) {
  try {
    if (['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { rows } = await db.query(
        `SELECT co.*, c.first_name, c.last_name FROM corrections co JOIN citizens c ON c.citizen_id = co.citizen_id
         JOIN departments d ON d.department_id = co.department_id WHERE d.department_key = 'home_affairs' ORDER BY co.created_at DESC`
      );
      return res.json({ corrections: rows });
    }
    if (!req.user.citizenId) return res.json({ corrections: [] });
    const { rows } = await db.query('SELECT * FROM corrections WHERE citizen_id = $1 ORDER BY created_at DESC', [req.user.citizenId]);
    res.json({ corrections: rows });
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/correction/:id/decide  body: { approve: boolean } */
async function decideCorrection(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const { approve } = req.body;
    const status = approve ? 'Approved' : 'Rejected';
    const { rows } = await db.query(
      `UPDATE corrections SET status = $1, reviewed_by_user_id = $2, reviewed_at = NOW(), updated_at = NOW() WHERE correction_id = $3 RETURNING *`,
      [status, req.user.userId, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Correction request not found.' });
    if (approve) {
      // For the prototype, only the "first_name"/"last_name"/"place_of_birth" fields can be applied automatically.
      const c = rows[0];
      if (['first_name', 'last_name', 'place_of_birth'].includes(c.field_name)) {
        await db.query(`UPDATE citizens SET ${c.field_name} = $1, updated_at = NOW() WHERE citizen_id = $2`, [c.requested_value, c.citizen_id]);
      }
    }
    await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: `CORRECTION_${status.toUpperCase()}`, targetType: 'correction', targetId: Number(req.params.id) });
    res.json({ correction: rows[0] });
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/death-registration  body: { citizenId, dateOfDeath, placeOfDeath } */
async function reportDeath(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to report a death.' });
    // A reporting citizen knows the deceased's permanent identity number, not an internal
    // database id — the same PIN-based lookup pattern used by identity verification and police.
    const { permanentIdentityNumber, dateOfDeath, placeOfDeath } = req.body;
    if (!permanentIdentityNumber || !dateOfDeath) {
      return res.status(400).json({ error: 'permanentIdentityNumber and dateOfDeath are required.' });
    }
    const { rows: citizenRows } = await db.query(
      'SELECT citizen_id, first_name, last_name, is_deceased FROM citizens WHERE permanent_identity_number = $1',
      [permanentIdentityNumber]
    );
    if (citizenRows.length === 0) {
      return res.status(404).json({ error: 'No citizen record matches that permanent identity number.' });
    }
    if (citizenRows[0].is_deceased) {
      return res.status(409).json({ error: 'A death has already been registered for this citizen.' });
    }
    const referenceNumber = generateReference('DR');
    const { rows } = await db.query(
      `INSERT INTO death_records (citizen_id, reported_by_citizen_id, registration_reference, date_of_death, place_of_death)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [citizenRows[0].citizen_id, req.user.citizenId, referenceNumber, dateOfDeath, placeOfDeath || null]
    );
    res.status(201).json({ deathRecord: rows[0], deceasedName: `${citizenRows[0].first_name} ${citizenRows[0].last_name}` });
  } catch (err) {
    next(err);
  }
}

/** POST /api/home-affairs/death-registration/:id/approve (officer) */
async function approveDeath(req, res, next) {
  try {
    if (!['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) return res.status(403).json({ error: 'Officer only.' });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM death_records WHERE death_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found.' }); }
      const record = rows[0];
      await client.query(`UPDATE death_records SET status = 'Approved', handling_officer_id = $1, approved_at = NOW(), updated_at = NOW() WHERE death_record_id = $2`, [req.user.userId, record.death_record_id]);
      await client.query(`UPDATE citizens SET is_deceased = TRUE, date_of_death = $1, updated_at = NOW() WHERE citizen_id = $2`, [record.date_of_death, record.citizen_id]);
      // Controlled notification to Pensions (per the report's design: a death registration
      // creates a notification for authorised pension officials, it does not expose the case elsewhere).
      const { rows: pensionOfficers } = await client.query(
        `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_key = 'pensions_officer'`
      );
      for (const officer of pensionOfficers) {
        // eslint-disable-next-line no-await-in-loop
        await createNotification({ userId: officer.user_id, title: 'Death registration recorded', message: `A death has been registered for a citizen with an active pension record (ref ${record.registration_reference}). Please review beneficiary status.`, type: 'System' });
      }
      await client.query('COMMIT');
      await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'DEATH_REGISTRATION_APPROVED', targetType: 'death_record', targetId: record.death_record_id });
      res.json({ deathRecordId: record.death_record_id, status: 'Approved' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
}

// ============================================================================================
// DEATH REGISTRATION — reportDeath/approveDeath existed already; list/get were missing
// entirely, which is why this service had no frontend at all despite working backend logic.
// ============================================================================================

/** GET /api/home-affairs/death-registration — citizen: deaths they reported. Officer: queue. */
async function listDeathRegistrations(req, res, next) {
  try {
    if (['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { rows } = await db.query(
        `SELECT dr.*, c.first_name, c.last_name, c.permanent_identity_number,
                rc.first_name AS reporter_first_name, rc.last_name AS reporter_last_name
         FROM death_records dr
         JOIN citizens c ON c.citizen_id = dr.citizen_id
         JOIN citizens rc ON rc.citizen_id = dr.reported_by_citizen_id
         ORDER BY dr.submitted_at DESC`
      );
      return res.json({ deathRegistrations: rows });
    }
    if (!req.user.citizenId) return res.json({ deathRegistrations: [] });
    const { rows } = await db.query(
      `SELECT dr.*, c.first_name, c.last_name, c.permanent_identity_number
       FROM death_records dr JOIN citizens c ON c.citizen_id = dr.citizen_id
       WHERE dr.reported_by_citizen_id = $1 ORDER BY dr.submitted_at DESC`,
      [req.user.citizenId]
    );
    res.json({ deathRegistrations: rows });
  } catch (err) { next(err); }
}

/** GET /api/home-affairs/death-registration/:id */
async function getDeathRegistration(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT dr.*, c.first_name, c.last_name, c.permanent_identity_number, c.date_of_birth
       FROM death_records dr JOIN citizens c ON c.citizen_id = dr.citizen_id
       WHERE dr.death_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Death registration not found.' });
    const record = rows[0];
    const isReporter = req.user.citizenId && record.reported_by_citizen_id === req.user.citizenId;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isReporter && !isOfficer) return res.status(403).json({ error: 'You do not have access to this record.' });
    res.json({ deathRegistration: record });
  } catch (err) { next(err); }
}

// ============================================================================================
// MARRIAGE REGISTRATION
//
// status flow: Submitted -> Under Review -> Verified -> Approved (certificate_number assigned)
//                                                     \-> Rejected
// The filer is always an already-verified citizen (spouse1's identity comes from the citizens
// table, same as birth registration's parent); spouse2 is recorded as supplied.
// ============================================================================================

async function createMarriageRegistration(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to register a marriage.' });
    const {
      spouse2Name, spouse2DateOfBirth, spouse2Nationality, spouse2PermanentIdentityNumber,
      marriageType, marriageDate, placeOfMarriage, witness1Name, witness2Name, officiantName,
      preferredOfficeId,
    } = req.body;
    if (!spouse2Name || !marriageType || !marriageDate || !placeOfMarriage || !witness1Name || !witness2Name) {
      return res.status(400).json({ error: 'spouse2Name, marriageType, marriageDate, placeOfMarriage, witness1Name and witness2Name are required.' });
    }
    if (!preferredOfficeId) return res.status(400).json({ error: 'preferredOfficeId is required.' });
    const referenceNumber = generateReference('MR');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO marriage_records (filer_citizen_id, registration_reference, spouse2_name,
            spouse2_date_of_birth, spouse2_nationality, spouse2_permanent_identity_number,
            marriage_type, marriage_date, place_of_marriage, witness1_name, witness2_name,
            officiant_name, preferred_office_id, status, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Submitted',NOW())
         RETURNING marriage_record_id`,
        [req.user.citizenId, referenceNumber, spouse2Name, spouse2DateOfBirth || null, spouse2Nationality || 'Mosotho',
         spouse2PermanentIdentityNumber || null, marriageType, marriageDate, placeOfMarriage, witness1Name, witness2Name,
         officiantName || null, preferredOfficeId]
      );
      const marriageRecordId = rows[0].marriage_record_id;
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Marriage Registration',
        referenceNumber, sourceTable: 'marriage_records', sourceId: marriageRecordId, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: 'Marriage registration submitted',
        message: `Your marriage registration ${referenceNumber} has been submitted and is awaiting review.`,
        type: 'Application Submitted',
      });
      res.status(201).json({ marriageRecordId, referenceNumber, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

async function listMarriageRegistrations(req, res, next) {
  try {
    if (['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT mr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name
         FROM marriage_records mr JOIN citizens c ON c.citizen_id = mr.filer_citizen_id
         WHERE $1::text IS NULL OR mr.status = $1 ORDER BY mr.submitted_at DESC`,
        [status || null]
      );
      return res.json({ marriageRegistrations: rows });
    }
    if (!req.user.citizenId) return res.json({ marriageRegistrations: [] });
    const { rows } = await db.query(
      `SELECT * FROM marriage_records WHERE filer_citizen_id = $1 ORDER BY submitted_at DESC`,
      [req.user.citizenId]
    );
    res.json({ marriageRegistrations: rows });
  } catch (err) { next(err); }
}

async function getMarriageRegistration(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT mr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name,
              c.date_of_birth AS filer_date_of_birth, c.sex AS filer_sex,
              c.permanent_identity_number AS filer_permanent_identity_number,
              o.name AS office_name
       FROM marriage_records mr
       JOIN citizens c ON c.citizen_id = mr.filer_citizen_id
       LEFT JOIN offices o ON o.office_id = mr.preferred_office_id
       WHERE mr.marriage_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Marriage registration not found.' });
    const record = rows[0];
    const isOwner = req.user.citizenId && record.filer_citizen_id === req.user.citizenId;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this application.' });
    res.json({ marriageRegistration: record });
  } catch (err) { next(err); }
}

async function transitionMarriage(req, res, next, { from, to, sideEffect }) {
  try {
    if (req.user.roleKey !== 'home_affairs_officer' && req.user.roleKey !== 'system_administrator') {
      return res.status(403).json({ error: 'Only Home Affairs officers can perform this action.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM marriage_records WHERE marriage_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Marriage registration not found.' }); }
      const record = rows[0];
      if (Array.isArray(from) ? !from.includes(record.status) : record.status !== from) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move from '${record.status}' to '${to}'.` });
      }
      const result = await (sideEffect ? sideEffect(client, record, req) : Promise.resolve({}));
      await client.query('COMMIT');
      res.json({ marriageRecordId: record.marriage_record_id, status: result.status || to, ...result.extra });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

function startReviewMarriage(req, res, next) {
  return transitionMarriage(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE marriage_records SET status = 'Under Review', updated_at = NOW() WHERE marriage_record_id = $1`, [record.marriage_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function requestInformationMarriage(req, res, next) {
  const { reason } = req.body;
  return transitionMarriage(req, res, next, {
    from: ['Under Review', 'Verified'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE marriage_records SET status = 'Additional Information Required', updated_at = NOW() WHERE marriage_record_id = $1`, [record.marriage_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.registration_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

function resubmitMarriage(req, res, next) {
  return transitionMarriage(req, res, next, {
    from: 'Additional Information Required', to: 'Under Review',
    sideEffect: async (client, record) => {
      if (record.filer_citizen_id !== req.user.citizenId) throw Object.assign(new Error('Not your application.'), { status: 403 });
      await client.query(`UPDATE marriage_records SET status = 'Under Review', updated_at = NOW() WHERE marriage_record_id = $1`, [record.marriage_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function verifyMarriage(req, res, next) {
  return transitionMarriage(req, res, next, {
    from: 'Under Review', to: 'Verified',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE marriage_records SET status = 'Verified', updated_at = NOW() WHERE marriage_record_id = $1`, [record.marriage_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Verified' });
      return { status: 'Verified' };
    },
  });
}

function approveMarriage(req, res, next) {
  return transitionMarriage(req, res, next, {
    from: 'Verified', to: 'Approved',
    sideEffect: async (client, record) => {
      const certificateNumber = generateReference('MC');
      await client.query(
        `UPDATE marriage_records SET status = 'Approved', certificate_number = $1, approved_at = NOW(), updated_at = NOW() WHERE marriage_record_id = $2`,
        [certificateNumber, record.marriage_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Approved', completed: true });
      await createNotification({
        userId: (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0]?.user_id,
        title: 'Marriage certificate issued', message: `Certificate ${certificateNumber} is ready to view.`, type: 'Approval',
      });
      return { status: 'Approved', extra: { certificateNumber } };
    },
  });
}

function rejectMarriage(req, res, next) {
  const { reason } = req.body;
  return transitionMarriage(req, res, next, {
    from: ['Submitted', 'Under Review', 'Verified'], to: 'Rejected',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE marriage_records SET status = 'Rejected', rejection_reason = $1, updated_at = NOW() WHERE marriage_record_id = $2`, [reason, record.marriage_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'marriage_records', sourceId: record.marriage_record_id, status: 'Rejected', completed: true });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Marriage registration rejected', message: reason, type: 'Rejection' });
      await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'MARRIAGE_REJECTED', targetType: 'marriage_record', targetId: record.marriage_record_id, reason });
      return { status: 'Rejected' };
    },
  });
}

/** GET /api/home-affairs/marriage-certificate/:id */
async function getMarriageCertificate(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT mr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name,
              c.date_of_birth AS filer_date_of_birth, c.sex AS filer_sex,
              c.permanent_identity_number AS filer_permanent_identity_number,
              o.name AS office_name
       FROM marriage_records mr
       JOIN citizens c ON c.citizen_id = mr.filer_citizen_id
       LEFT JOIN offices o ON o.office_id = mr.preferred_office_id
       WHERE mr.marriage_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    const record = rows[0];
    if (record.status !== 'Approved') return res.status(409).json({ error: 'This certificate has not been issued yet.' });
    const isOwner = req.user.citizenId && req.user.citizenId === record.filer_citizen_id;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this certificate.' });
    res.json({ marriageCertificate: record });
  } catch (err) { next(err); }
}

// ============================================================================================
// DIVORCE REGISTRATION
//
// Home Affairs registers a divorce that a Lesotho court has already granted — it requires the
// court's own reference rather than a stated reason, because this system administratively
// records a legal fact, it does not adjudicate one.
// status flow: Submitted -> Under Review -> Verified -> Approved (certificate_number assigned)
//                                                     \-> Rejected
// ============================================================================================

async function createDivorceRegistration(req, res, next) {
  try {
    if (!req.user.citizenId) return res.status(403).json({ error: 'A verified identity is required to register a divorce.' });
    const {
      spouseName, spousePermanentIdentityNumber, marriageReference,
      courtName, courtOrderReference, divorceOrderDate, preferredOfficeId,
    } = req.body;
    if (!spouseName || !courtName || !courtOrderReference || !divorceOrderDate) {
      return res.status(400).json({ error: 'spouseName, courtName, courtOrderReference and divorceOrderDate are required.' });
    }
    if (!preferredOfficeId) return res.status(400).json({ error: 'preferredOfficeId is required.' });
    const referenceNumber = generateReference('DV');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO divorce_records (filer_citizen_id, registration_reference, spouse_name,
            spouse_permanent_identity_number, marriage_reference, court_name, court_order_reference,
            divorce_order_date, preferred_office_id, status, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Submitted',NOW())
         RETURNING divorce_record_id`,
        [req.user.citizenId, referenceNumber, spouseName, spousePermanentIdentityNumber || null,
         marriageReference || null, courtName, courtOrderReference, divorceOrderDate, preferredOfficeId]
      );
      const divorceRecordId = rows[0].divorce_record_id;
      await indexApplication(client, {
        citizenId: req.user.citizenId, departmentKey: 'home_affairs', serviceType: 'Divorce Registration',
        referenceNumber, sourceTable: 'divorce_records', sourceId: divorceRecordId, status: 'Submitted',
      });
      await client.query('COMMIT');
      await createNotification({
        userId: req.user.userId, title: 'Divorce registration submitted',
        message: `Your divorce registration ${referenceNumber} has been submitted and is awaiting review.`,
        type: 'Application Submitted',
      });
      res.status(201).json({ divorceRecordId, referenceNumber, status: 'Submitted' });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

async function listDivorceRegistrations(req, res, next) {
  try {
    if (['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey)) {
      const { status } = req.query;
      const { rows } = await db.query(
        `SELECT dvr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name
         FROM divorce_records dvr JOIN citizens c ON c.citizen_id = dvr.filer_citizen_id
         WHERE $1::text IS NULL OR dvr.status = $1 ORDER BY dvr.submitted_at DESC`,
        [status || null]
      );
      return res.json({ divorceRegistrations: rows });
    }
    if (!req.user.citizenId) return res.json({ divorceRegistrations: [] });
    const { rows } = await db.query(
      `SELECT * FROM divorce_records WHERE filer_citizen_id = $1 ORDER BY submitted_at DESC`,
      [req.user.citizenId]
    );
    res.json({ divorceRegistrations: rows });
  } catch (err) { next(err); }
}

async function getDivorceRegistration(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT dvr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name,
              c.permanent_identity_number AS filer_permanent_identity_number,
              o.name AS office_name
       FROM divorce_records dvr
       JOIN citizens c ON c.citizen_id = dvr.filer_citizen_id
       LEFT JOIN offices o ON o.office_id = dvr.preferred_office_id
       WHERE dvr.divorce_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Divorce registration not found.' });
    const record = rows[0];
    const isOwner = req.user.citizenId && record.filer_citizen_id === req.user.citizenId;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this application.' });
    res.json({ divorceRegistration: record });
  } catch (err) { next(err); }
}

async function transitionDivorce(req, res, next, { from, to, sideEffect }) {
  try {
    if (req.user.roleKey !== 'home_affairs_officer' && req.user.roleKey !== 'system_administrator') {
      return res.status(403).json({ error: 'Only Home Affairs officers can perform this action.' });
    }
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM divorce_records WHERE divorce_record_id = $1 FOR UPDATE', [req.params.id]);
      if (rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Divorce registration not found.' }); }
      const record = rows[0];
      if (Array.isArray(from) ? !from.includes(record.status) : record.status !== from) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Cannot move from '${record.status}' to '${to}'.` });
      }
      const result = await (sideEffect ? sideEffect(client, record, req) : Promise.resolve({}));
      await client.query('COMMIT');
      res.json({ divorceRecordId: record.divorce_record_id, status: result.status || to, ...result.extra });
    } catch (err) {
      await client.query('ROLLBACK'); throw err;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
}

function startReviewDivorce(req, res, next) {
  return transitionDivorce(req, res, next, {
    from: 'Submitted', to: 'Under Review',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE divorce_records SET status = 'Under Review', updated_at = NOW() WHERE divorce_record_id = $1`, [record.divorce_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function requestInformationDivorce(req, res, next) {
  const { reason } = req.body;
  return transitionDivorce(req, res, next, {
    from: ['Under Review', 'Verified'], to: 'Additional Information Required',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE divorce_records SET status = 'Additional Information Required', updated_at = NOW() WHERE divorce_record_id = $1`, [record.divorce_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Additional Information Required' });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Additional information required', message: `Reference ${record.registration_reference}: ${reason}`, type: 'Missing Information' });
      return { status: 'Additional Information Required' };
    },
  });
}

function resubmitDivorce(req, res, next) {
  return transitionDivorce(req, res, next, {
    from: 'Additional Information Required', to: 'Under Review',
    sideEffect: async (client, record) => {
      if (record.filer_citizen_id !== req.user.citizenId) throw Object.assign(new Error('Not your application.'), { status: 403 });
      await client.query(`UPDATE divorce_records SET status = 'Under Review', updated_at = NOW() WHERE divorce_record_id = $1`, [record.divorce_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Under Review' });
      return { status: 'Under Review' };
    },
  });
}

function verifyDivorce(req, res, next) {
  return transitionDivorce(req, res, next, {
    from: 'Under Review', to: 'Verified',
    sideEffect: async (client, record) => {
      await client.query(`UPDATE divorce_records SET status = 'Verified', updated_at = NOW() WHERE divorce_record_id = $1`, [record.divorce_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Verified' });
      return { status: 'Verified' };
    },
  });
}

function approveDivorce(req, res, next) {
  return transitionDivorce(req, res, next, {
    from: 'Verified', to: 'Approved',
    sideEffect: async (client, record) => {
      const certificateNumber = generateReference('DVC');
      await client.query(
        `UPDATE divorce_records SET status = 'Approved', certificate_number = $1, approved_at = NOW(), updated_at = NOW() WHERE divorce_record_id = $2`,
        [certificateNumber, record.divorce_record_id]
      );
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Approved', completed: true });
      await createNotification({
        userId: (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0]?.user_id,
        title: 'Divorce certificate issued', message: `Certificate ${certificateNumber} is ready to view.`, type: 'Approval',
      });
      return { status: 'Approved', extra: { certificateNumber } };
    },
  });
}

function rejectDivorce(req, res, next) {
  const { reason } = req.body;
  return transitionDivorce(req, res, next, {
    from: ['Submitted', 'Under Review', 'Verified'], to: 'Rejected',
    sideEffect: async (client, record) => {
      if (!reason) throw Object.assign(new Error('A reason is required.'), { status: 400 });
      await client.query(`UPDATE divorce_records SET status = 'Rejected', rejection_reason = $1, updated_at = NOW() WHERE divorce_record_id = $2`, [reason, record.divorce_record_id]);
      await syncApplicationStatus(client, { sourceTable: 'divorce_records', sourceId: record.divorce_record_id, status: 'Rejected', completed: true });
      const userRow = (await client.query('SELECT user_id FROM users WHERE citizen_id = $1', [record.filer_citizen_id])).rows[0];
      if (userRow) await createNotification({ userId: userRow.user_id, title: 'Divorce registration rejected', message: reason, type: 'Rejection' });
      await recordAudit({ userId: req.user.userId, departmentId: await getDepartmentId('home_affairs'), action: 'DIVORCE_REJECTED', targetType: 'divorce_record', targetId: record.divorce_record_id, reason });
      return { status: 'Rejected' };
    },
  });
}

/** GET /api/home-affairs/divorce-certificate/:id */
async function getDivorceCertificate(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT dvr.*, c.first_name AS filer_first_name, c.last_name AS filer_last_name,
              c.permanent_identity_number AS filer_permanent_identity_number,
              o.name AS office_name
       FROM divorce_records dvr
       JOIN citizens c ON c.citizen_id = dvr.filer_citizen_id
       LEFT JOIN offices o ON o.office_id = dvr.preferred_office_id
       WHERE dvr.divorce_record_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found.' });
    const record = rows[0];
    if (record.status !== 'Approved') return res.status(409).json({ error: 'This certificate has not been issued yet.' });
    const isOwner = req.user.citizenId && req.user.citizenId === record.filer_citizen_id;
    const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(req.user.roleKey);
    if (!isOwner && !isOfficer) return res.status(403).json({ error: 'You do not have access to this certificate.' });
    res.json({ divorceCertificate: record });
  } catch (err) { next(err); }
}

module.exports = {
  createBirthRegistration, listBirthRegistrations, getBirthRegistration,
  startReviewBirthRegistration, requestInformationBirthRegistration, resubmitBirthRegistration,
  verifyBirthRegistration, confirmVerificationBirthRegistration, approveBirthRegistration, rejectBirthRegistration,
  getBirthCertificate, markCertificateReadyForCollection, collectBirthCertificate,
  applyNationalId, listNationalId, getNationalId, transitionNationalId,
  submitCorrection, listCorrections, decideCorrection,
  reportDeath, approveDeath, listDeathRegistrations, getDeathRegistration,
  createMarriageRegistration, listMarriageRegistrations, getMarriageRegistration,
  startReviewMarriage, requestInformationMarriage, resubmitMarriage, verifyMarriage, approveMarriage, rejectMarriage,
  getMarriageCertificate,
  createDivorceRegistration, listDivorceRegistrations, getDivorceRegistration,
  startReviewDivorce, requestInformationDivorce, resubmitDivorce, verifyDivorce, approveDivorce, rejectDivorce,
  getDivorceCertificate,
};
