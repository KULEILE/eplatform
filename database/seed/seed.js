/**
 * Seeds the database with entirely FICTIONAL demonstration data — citizens, employees,
 * applications across all six departments, notifications and audit logs — so the prototype
 * is immediately explorable without manually walking every workflow first.
 *
 * Every record inserted here is tagged is_demo_data = TRUE where the column exists, and the
 * frontend displays a persistent "Prototype / Demonstration Data" banner (see
 * frontend/src/components/layout/DemoBanner.jsx).
 *
 * Usage: DATABASE_URL=postgres://... node seed/seed.js
 */
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/gov_services';
const DEMO_PASSWORD = 'Passw0rd!';
// Hosted providers (Render, Supabase, RDS, etc.) require SSL on external connections.
const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);

// --- helpers -----------------------------------------------------------------------------

/** Mirrors backend/src/utils/idGenerator.js: YYYYMMDD + 6-digit sequence. Generated ONCE per
 *  person and never regenerated. */
function permanentIdentityNumber(dob, seq) {
  const yyyymmdd = dob.replace(/-/g, '');
  return `${yyyymmdd}${String(seq).padStart(6, '0')}`;
}

function ref(prefix, year, seq) {
  return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
}

async function hash(pw) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: isLocal ? false : { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Seeding ${DATABASE_URL.replace(/:[^:@]*@/, ':****@')} ...`);

  // Wipe existing demo data (idempotent re-seed) — respects FK order. Districts are reference
  // data owned by the migrations (022), not truncated here.
  await client.query(`
    TRUNCATE TABLE
      audit_logs, notifications, application_documents, applications, appointments,
      police_records, pension_records, finance_records, traffic_records, passport_records,
      national_id_cards, birth_certificates, birth_records, offices, users, citizens
    RESTART IDENTITY CASCADE;
  `);

  const roleId = {};
  const { rows: roles } = await client.query('SELECT role_id, role_key FROM roles');
  roles.forEach((r) => { roleId[r.role_key] = r.role_id; });

  const deptId = {};
  const { rows: depts } = await client.query('SELECT department_id, department_key FROM departments');
  depts.forEach((d) => { deptId[d.department_key] = d.department_id; });

  const districtId = {};
  const { rows: districts } = await client.query('SELECT district_id, code FROM districts');
  districts.forEach((d) => { districtId[d.code] = d.district_id; });

  // --- offices (branches) -------------------------------------------------------------------
  // Spread across five of Lesotho's ten districts, so the district -> branch picker has real
  // choices to demonstrate. [deptKey, name, districtCode, officeCode, address, isHeadOffice]
  const officeRows = [
    ['home_affairs', 'Maseru Home Affairs Office',        'MSU', 'HA-MSU-01', 'Kingsway Road, Maseru',        true],
    ['home_affairs', 'Leribe Home Affairs Office',        'LRB', 'HA-LRB-01', 'Main Street, Hlotse',          false],
    ['home_affairs', 'Berea Home Affairs Office',         'BER', 'HA-BER-01', 'Marakabei Road, Teyateyaneng', false],
    ['home_affairs', 'Mafeteng Home Affairs Office',      'MFT', 'HA-MFT-01', 'Main North Road, Mafeteng',    false],
    ["home_affairs", "Mohale's Hoek Home Affairs Office", 'MHK', 'HA-MHK-01', "Main Road, Mohale's Hoek",     false],
    ['traffic',      'Maseru Traffic Office',             'MSU', 'TR-MSU-01', 'Moshoeshoe Road, Maseru',      true],
    ['traffic',      'Leribe Traffic Office',              'LRB', 'TR-LRB-01', 'Hlotse Road, Leribe',          false],
    ['police',       'Maseru Central Police Station',      'MSU', 'PO-MSU-01', 'Kingsway, Maseru',             true],
    ['police',       'Leribe Police Station',              'LRB', 'PO-LRB-01', 'Hlotse, Leribe',               false],
    ['passport',     'Maseru Passport Office',             'MSU', 'PA-MSU-01', 'Constitution Road, Maseru',    true],
    ['pensions',     'Maseru Pensions Office',             'MSU', 'PE-MSU-01', 'Parliament Road, Maseru',      true],
    ['finance',      'Maseru Finance Office',              'MSU', 'FI-MSU-01', 'Kingsway, Maseru',             true],
  ];
  const officeId = {};
  for (const [deptKey, name, distCode, officeCode, address, isHeadOffice] of officeRows) {
    const { rows } = await client.query(
      `INSERT INTO offices (department_id, district_id, office_code, name, address, is_head_office)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING office_id`,
      [deptId[deptKey], districtId[distCode], officeCode, name, address, isHeadOffice]
    );
    officeId[name] = rows[0].office_id;
  }

  // --- citizens ----------------------------------------------------------------------------
  // Adults get identity_verification_status 'Verified'; children created via birth registration
  // are inserted later, at the point their birth record is "approved" (mirrors the real workflow).
  const citizens = [
    { key: 'thabo',      first: 'Thabo',      last: 'Mokoena',   dob: '1988-03-14', sex: 'Male',   pob: 'Maseru' },
    { key: 'palesa_m',   first: 'Palesa',     last: 'Mokoena',   dob: '1990-07-22', sex: 'Female', pob: 'Maseru' },
    { key: 'teboho',     first: 'Teboho',     last: 'Ntsane',    dob: '1995-11-02', sex: 'Male',   pob: 'Leribe' },
    { key: 'mamello',    first: 'Mamello',    last: 'Ntsane',    dob: '1996-01-19', sex: 'Female', pob: 'Leribe' },
    { key: 'retse',      first: 'Retšelisitsoe', last: 'Khoali', dob: '1992-05-30', sex: 'Male',   pob: 'Mafeteng' },
    { key: 'nthabiseng', first: 'Nthabiseng', last: 'Lelosa',    dob: '1985-09-08', sex: 'Female', pob: 'Berea' },
    { key: 'mpho',       first: 'Mpho',       last: 'Sekonyela', dob: '1979-12-25', sex: 'Male',   pob: 'Maseru' },
    { key: 'litsoanelo', first: 'Litšoanelo', last: 'Mahao',     dob: '1958-04-11', sex: 'Female', pob: 'Mohale\'s Hoek' },
    { key: 'karabo',     first: 'Karabo',     last: 'Foso',      dob: '1993-08-17', sex: 'Male',   pob: 'Maseru' },
    { key: 'mamosa',     first: 'Mamosa',     last: 'Ramaema',   dob: '1972-02-02', sex: 'Female', pob: 'Qacha\'s Nek' },
  ];

  const cid = {}; // key -> citizen_id
  const pin = {}; // key -> permanent_identity_number
  let seq = 1;
  for (const c of citizens) {
    const p = permanentIdentityNumber(c.dob, seq++);
    const { rows } = await client.query(
      `INSERT INTO citizens (permanent_identity_number, first_name, last_name, date_of_birth,
                              place_of_birth, sex, citizenship_status, biometric_status,
                              identity_verification_status, is_demo_data)
       VALUES ($1,$2,$3,$4,$5,$6,'Citizen',$7,'Verified',TRUE) RETURNING citizen_id`,
      [p, c.first, c.last, c.dob, c.pob, c.sex, c.key === 'thabo' ? 'Enrolled' : 'Not Enrolled']
    );
    cid[c.key] = rows[0].citizen_id;
    pin[c.key] = p;
  }

  // --- users (portal accounts) ---------------------------------------------------------------
  const pwHash = await hash(DEMO_PASSWORD);

  async function makeUser({
    citizenKey = null, email, phone, roleKey, deptKey = null, officeKey = null,
    provisional = false, lang = 'en', mustChangePassword = false, appointedBy = null, password = null,
  }) {
    const hashToUse = password ? await hash(password) : pwHash;
    const { rows } = await client.query(
      `INSERT INTO users (citizen_id, email, phone, password_hash, role_id, department_id, office_id,
                           is_provisional, preferred_language, account_status, must_change_password, appointed_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Active',$10,$11) RETURNING user_id`,
      [citizenKey ? cid[citizenKey] : null, email, phone, hashToUse, roleId[roleKey],
       deptKey ? deptId[deptKey] : null, officeKey ? officeId[officeKey] : null, provisional, lang,
       mustChangePassword, appointedBy]
    );
    return rows[0].user_id;
  }

  const uid = {};
  uid.thabo = await makeUser({ citizenKey: 'thabo', email: 'thabo.mokoena@example.ls', phone: '+26658123456', roleKey: 'citizen' });
  uid.teboho = await makeUser({ citizenKey: 'teboho', email: 'teboho.ntsane@example.ls', phone: '+26658223344', roleKey: 'citizen' });
  uid.litsoanelo = await makeUser({ citizenKey: 'litsoanelo', email: 'litsoanelo.mahao@example.ls', phone: '+26658556677', roleKey: 'citizen', lang: 'st' });
  uid.karabo = await makeUser({ citizenKey: 'karabo', email: 'karabo.foso@example.ls', phone: '+26658334455', roleKey: 'citizen' });
  // Provisional account: no verified citizen record linked yet (Option B in the registration flow)
  uid.provisional = await makeUser({ email: 'palesa.new@example.ls', phone: '+26658998877', roleKey: 'citizen', provisional: true });

  // System Administrator (head office) — appoints Branch Administrators.
  uid.admin = await makeUser({ email: 'admin@gov.ls', phone: '+26622110000', roleKey: 'system_administrator' });

  // Branch Administrators — appointed by the System Administrator, one per branch shown here.
  // They in turn create the officer accounts for their own branch (see uid.officerHomeAffairs below).
  uid.branchAdminHomeAffairsMaseru = await makeUser({
    email: 'branchadmin.homeaffairs.maseru@gov.ls', phone: '+26622110010', roleKey: 'branch_admin',
    deptKey: 'home_affairs', officeKey: 'Maseru Home Affairs Office', appointedBy: uid.admin,
  });
  uid.branchAdminHomeAffairsLeribe = await makeUser({
    email: 'branchadmin.homeaffairs.leribe@gov.ls', phone: '+26622110011', roleKey: 'branch_admin',
    deptKey: 'home_affairs', officeKey: 'Leribe Home Affairs Office', appointedBy: uid.admin,
  });

  // Officers — appointed by their branch's Branch Administrator (not directly by the System
  // Administrator), matching the devolved onboarding model.
  uid.officerHomeAffairs = await makeUser({
    email: 'officer.homeaffairs@gov.ls', phone: '+26622110001', roleKey: 'home_affairs_officer',
    deptKey: 'home_affairs', officeKey: 'Maseru Home Affairs Office', appointedBy: uid.branchAdminHomeAffairsMaseru,
  });
  uid.officerTraffic  = await makeUser({ email: 'officer.traffic@gov.ls',  phone: '+26622110002', roleKey: 'traffic_officer',  deptKey: 'traffic',  officeKey: 'Maseru Traffic Office', appointedBy: uid.admin });
  uid.officerFinance  = await makeUser({ email: 'officer.finance@gov.ls',  phone: '+26622110003', roleKey: 'finance_officer',  deptKey: 'finance',  officeKey: 'Maseru Finance Office', appointedBy: uid.admin });
  uid.officerPensions = await makeUser({ email: 'officer.pensions@gov.ls', phone: '+26622110004', roleKey: 'pensions_officer', deptKey: 'pensions', officeKey: 'Maseru Pensions Office', appointedBy: uid.admin });
  uid.officerPolice   = await makeUser({ email: 'officer.police@gov.ls',  phone: '+26622110005', roleKey: 'police_officer',   deptKey: 'police',   officeKey: 'Maseru Central Police Station', appointedBy: uid.admin });
  uid.officerPassport = await makeUser({ email: 'officer.passport@gov.ls', phone: '+26622110006', roleKey: 'passport_officer', deptKey: 'passport', officeKey: 'Maseru Passport Office', appointedBy: uid.admin });

  // A freshly onboarded officer, still on their temporary password — demonstrates the forced
  // change-password-at-first-login flow described in the assignment. Password is intentionally
  // NOT the shared demo password so it's clearly a one-time credential to be changed.
  uid.officerHomeAffairsLeribeNew = await makeUser({
    email: 'new.officer.homeaffairs.leribe@gov.ls', phone: '+26622110012', roleKey: 'home_affairs_officer',
    deptKey: 'home_affairs', officeKey: 'Leribe Home Affairs Office', appointedBy: uid.branchAdminHomeAffairsLeribe,
    mustChangePassword: true, password: 'TempPass2026!',
  });

  // --- applications index helper -------------------------------------------------------------
  async function indexApplication({ citizenKey, deptKey, serviceType, referenceNumber, sourceTable, sourceId, status, submittedAt, completedAt = null }) {
    const { rows } = await client.query(
      `INSERT INTO applications (citizen_id, department_id, service_type, reference_number,
                                  source_table, source_id, status, submitted_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING application_id`,
      [cid[citizenKey], deptId[deptKey], serviceType, referenceNumber, sourceTable, sourceId, status, submittedAt, completedAt]
    );
    return rows[0].application_id;
  }

  async function notify({ userId, title, message, type, appId = null, lang = 'en', read = false }) {
    await client.query(
      `INSERT INTO notifications (user_id, title, message, language, notification_type, related_application_id, is_read)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, title, message, lang, type, appId, read]
    );
  }

  async function audit({ userId, deptKey, action, targetType, targetId, reason = null, metadata = null }) {
    await client.query(
      `INSERT INTO audit_logs (user_id, department_id, action, target_type, target_id, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, deptId[deptKey], action, targetType, targetId, reason, metadata ? JSON.stringify(metadata) : null]
    );
  }

  // === HOME AFFAIRS: Birth Registration (three states of the workflow) ======================

  // 1) Lineo — fully approved, certificate ready for collection (demonstrates the full happy path)
  const lineoRegRef = ref('BR', 2026, 1);
  const { rows: br1 } = await client.query(
    `INSERT INTO birth_records (parent_citizen_id, registration_reference, child_first_name,
       child_last_name, date_of_birth, place_of_birth, sex, registration_status,
       handling_officer_id, submitted_at, verified_at, approved_at, preferred_office_id)
     VALUES ($1,$2,'Lineo','Mokoena','2024-02-10','Maseru','Female','Approved',$3,
             NOW() - INTERVAL '40 days', NOW() - INTERVAL '30 days', NOW() - INTERVAL '25 days', $4)
     RETURNING birth_record_id`,
    [cid.thabo, lineoRegRef, uid.officerHomeAffairs, officeId['Maseru Home Affairs Office']]
  );
  const lineoRegId = br1[0].birth_record_id;
  const lineoPin = permanentIdentityNumber('2024-02-10', seq++);
  const { rows: lineoCitizen } = await client.query(
    `INSERT INTO citizens (permanent_identity_number, first_name, last_name, date_of_birth,
                            place_of_birth, sex, citizenship_status, identity_verification_status,
                            parent_citizen_id, is_demo_data)
     VALUES ($1,'Lineo','Mokoena','2024-02-10','Maseru','Female','Citizen','Verified',$2,TRUE)
     RETURNING citizen_id`,
    [lineoPin, cid.thabo]
  );
  cid.lineo = lineoCitizen[0].citizen_id;
  await client.query(`UPDATE birth_records SET citizen_id = $1 WHERE birth_record_id = $2`, [cid.lineo, lineoRegId]);

  const lineoCertRef = ref('BC', 2026, 1);
  const { rows: cert1 } = await client.query(
    `INSERT INTO birth_certificates (citizen_id, birth_record_id, certificate_number, issue_date,
        status, collection_office_id, ready_for_collection_at)
     VALUES ($1,$2,$3, CURRENT_DATE - 24, 'Ready for Collection', $4, NOW() - INTERVAL '24 days')
     RETURNING birth_certificate_id`,
    [cid.lineo, lineoRegId, lineoCertRef, officeId['Maseru Home Affairs Office']]
  );
  const lineoAppId = await indexApplication({
    citizenKey: 'thabo', deptKey: 'home_affairs', serviceType: 'Birth Registration',
    referenceNumber: lineoRegRef, sourceTable: 'birth_records', sourceId: lineoRegId,
    status: 'Approved', submittedAt: new Date(Date.now() - 40 * 86400000), completedAt: new Date(Date.now() - 25 * 86400000),
  });
  await notify({ userId: uid.thabo, title: 'Birth certificate ready for collection',
    message: `The birth certificate for Lineo Mokoena (reference ${lineoCertRef}) is ready for collection at Maseru Home Affairs Office.`,
    type: 'Ready for Collection', appId: lineoAppId });

  // 2) Baby of Teboho & Mamello — under review (in-flight, for officer demo)
  const sechabaRegRef = ref('BR', 2026, 2);
  const { rows: br2 } = await client.query(
    `INSERT INTO birth_records (parent_citizen_id, registration_reference, child_first_name,
       child_last_name, date_of_birth, place_of_birth, sex, registration_status, submitted_at, preferred_office_id)
     VALUES ($1,$2,'Sechaba','Ntsane','2026-08-02','Leribe','Male','Under Review', NOW() - INTERVAL '5 days', $3)
     RETURNING birth_record_id`,
    [cid.teboho, sechabaRegRef, officeId['Leribe Home Affairs Office']]
  );
  await indexApplication({
    citizenKey: 'teboho', deptKey: 'home_affairs', serviceType: 'Birth Registration',
    referenceNumber: sechabaRegRef, sourceTable: 'birth_records', sourceId: br2[0].birth_record_id,
    status: 'Under Review', submittedAt: new Date(Date.now() - 5 * 86400000),
  });
  await notify({ userId: uid.teboho, title: 'Birth registration under review',
    message: `Your birth registration application ${sechabaRegRef} for Sechaba Ntsane is under review by Home Affairs.`,
    type: 'Status Change' });

  // 3) Baby of Mpho — information required (demonstrates the "action needed" state)
  const rethabileRegRef = ref('BR', 2026, 3);
  const { rows: br3 } = await client.query(
    `INSERT INTO birth_records (parent_citizen_id, registration_reference, child_first_name,
       child_last_name, date_of_birth, place_of_birth, sex, registration_status, submitted_at, preferred_office_id)
     VALUES ($1,$2,'Rethabile','Sekonyela','2026-07-20','Maseru','Female','Information Required', NOW() - INTERVAL '10 days', $3)
     RETURNING birth_record_id`,
    [cid.mpho, rethabileRegRef, officeId['Maseru Home Affairs Office']]
  );
  await indexApplication({
    citizenKey: 'mpho', deptKey: 'home_affairs', serviceType: 'Birth Registration',
    referenceNumber: rethabileRegRef, sourceTable: 'birth_records', sourceId: br3[0].birth_record_id,
    status: 'Information Required', submittedAt: new Date(Date.now() - 10 * 86400000),
  });

  // === HOME AFFAIRS: National ID Card ========================================================

  // Thabo already has his card, fully collected
  const thaboCardNum = 'NID-' + String(100000 + 1);
  const { rows: nid1 } = await client.query(
    `INSERT INTO national_id_cards (citizen_id, permanent_identity_number, card_number,
        application_date, approval_date, production_status, collection_office_id, preferred_office_id,
        ready_for_collection_at, collected_at, photo_reference, biometric_status)
     VALUES ($1,$2,$3, CURRENT_DATE - 200, CURRENT_DATE - 180, 'Collected', $4, $4,
             NOW() - INTERVAL '170 days', NOW() - INTERVAL '165 days', 'demo-photo-thabo.jpg', 'Enrolled')
     RETURNING national_id_card_id`,
    [cid.thabo, pin.thabo, thaboCardNum, officeId['Maseru Home Affairs Office']]
  );
  await indexApplication({
    citizenKey: 'thabo', deptKey: 'home_affairs', serviceType: 'National ID Card',
    referenceNumber: thaboCardNum, sourceTable: 'national_id_cards', sourceId: nid1[0].national_id_card_id,
    status: 'Collected', submittedAt: new Date(Date.now() - 200 * 86400000), completedAt: new Date(Date.now() - 165 * 86400000),
  });

  // Teboho — application in progress, no card number assigned yet
  const { rows: nid2 } = await client.query(
    `INSERT INTO national_id_cards (citizen_id, permanent_identity_number, application_date,
        production_status, photo_reference, preferred_office_id, collection_office_id)
     VALUES ($1,$2, CURRENT_DATE - 6, 'Verification in Progress', 'demo-photo-teboho.jpg', $3, $3)
     RETURNING national_id_card_id`,
    [cid.teboho, pin.teboho, officeId['Leribe Home Affairs Office']]
  );
  const teboAppId = await indexApplication({
    citizenKey: 'teboho', deptKey: 'home_affairs', serviceType: 'National ID Card',
    referenceNumber: ref('NIDA', 2026, 2), sourceTable: 'national_id_cards', sourceId: nid2[0].national_id_card_id,
    status: 'Verification in Progress', submittedAt: new Date(Date.now() - 6 * 86400000),
  });
  await notify({ userId: uid.teboho, title: 'Identity verification in progress',
    message: 'Your National ID card application is being verified against your Home Affairs identity record.',
    type: 'Verification', appId: teboAppId });

  // === PASSPORT SERVICES ======================================================================

  // Thabo — approved, ready for collection
  const thaboPassRef = ref('PA', 2026, 1);
  const { rows: pass1 } = await client.query(
    `INSERT INTO passport_records (citizen_id, application_reference, passport_type, status,
        issue_date, expiry_date, collection_office_id, preferred_office_id, ready_for_collection_at)
     VALUES ($1,$2,'Ordinary','Ready for Collection', CURRENT_DATE - 3, CURRENT_DATE + (365*9), $3, $3, NOW() - INTERVAL '3 days')
     RETURNING passport_record_id`,
    [cid.thabo, thaboPassRef, officeId['Maseru Passport Office']]
  );
  await client.query(`UPDATE passport_records SET passport_number = $1 WHERE passport_record_id = $2`,
    ['P0231458', pass1[0].passport_record_id]);
  const thaboPassAppId = await indexApplication({
    citizenKey: 'thabo', deptKey: 'passport', serviceType: 'Passport Application',
    referenceNumber: thaboPassRef, sourceTable: 'passport_records', sourceId: pass1[0].passport_record_id,
    status: 'Ready for Collection', submittedAt: new Date(Date.now() - 45 * 86400000),
  });
  await notify({ userId: uid.thabo, title: 'Passport ready for collection',
    message: `Your passport (application ${thaboPassRef}) is ready for collection at Maseru Passport Office. Please bring your National ID card.`,
    type: 'Ready for Collection', appId: thaboPassAppId });

  // Retse — documents checked, mid-workflow
  const retsePassRef = ref('PA', 2026, 2);
  const { rows: pass2 } = await client.query(
    `INSERT INTO passport_records (citizen_id, application_reference, passport_type, status, preferred_office_id)
     VALUES ($1,$2,'Ordinary','Documents Checked',$3) RETURNING passport_record_id`,
    [cid.retse, retsePassRef, officeId['Maseru Passport Office']]
  );
  await indexApplication({
    citizenKey: 'retse', deptKey: 'passport', serviceType: 'Passport Application',
    referenceNumber: retsePassRef, sourceTable: 'passport_records', sourceId: pass2[0].passport_record_id,
    status: 'Documents Checked', submittedAt: new Date(Date.now() - 8 * 86400000),
  });

  // === TRAFFIC ================================================================================

  const nthabisengTrafficRef = ref('TR', 2026, 1);
  const { rows: traf1 } = await client.query(
    `INSERT INTO traffic_records (citizen_id, application_reference, service_type, licence_number,
        status, issue_date, expiry_date, ready_for_collection_at)
     VALUES ($1,$2,'Driving Licence Renewal','DL-004821','Ready for Collection', CURRENT_DATE, CURRENT_DATE + (365*5), NOW() - INTERVAL '1 day')
     RETURNING traffic_record_id`,
    [cid.nthabiseng, nthabisengTrafficRef]
  );
  await indexApplication({
    citizenKey: 'nthabiseng', deptKey: 'traffic', serviceType: 'Driving Licence Renewal',
    referenceNumber: nthabisengTrafficRef, sourceTable: 'traffic_records', sourceId: traf1[0].traffic_record_id,
    status: 'Ready for Collection', submittedAt: new Date(Date.now() - 12 * 86400000),
  });

  const thaboTrafficRef = ref('TR', 2026, 2);
  const { rows: traf2 } = await client.query(
    `INSERT INTO traffic_records (citizen_id, application_reference, service_type, status)
     VALUES ($1,$2,'Vehicle Registration','Processing') RETURNING traffic_record_id`,
    [cid.thabo, thaboTrafficRef]
  );
  await indexApplication({
    citizenKey: 'thabo', deptKey: 'traffic', serviceType: 'Vehicle Registration',
    referenceNumber: thaboTrafficRef, sourceTable: 'traffic_records', sourceId: traf2[0].traffic_record_id,
    status: 'Processing', submittedAt: new Date(Date.now() - 2 * 86400000),
  });

  // === FINANCE =================================================================================

  const mphoFinanceRef = ref('FIN', 2026, 1);
  const { rows: fin1 } = await client.query(
    `INSERT INTO finance_records (citizen_id, application_reference, service_type, status, validated_information_note)
     VALUES ($1,$2,'Supplier Registration Validation','Completed','Identity and registered address confirmed against Home Affairs records.')
     RETURNING finance_record_id`,
    [cid.mpho, mphoFinanceRef]
  );
  await indexApplication({
    citizenKey: 'mpho', deptKey: 'finance', serviceType: 'Supplier Registration Validation',
    referenceNumber: mphoFinanceRef, sourceTable: 'finance_records', sourceId: fin1[0].finance_record_id,
    status: 'Completed', submittedAt: new Date(Date.now() - 20 * 86400000), completedAt: new Date(Date.now() - 15 * 86400000),
  });

  const karaboFinanceRef = ref('FIN', 2026, 2);
  const { rows: fin2 } = await client.query(
    `INSERT INTO finance_records (citizen_id, application_reference, service_type, status)
     VALUES ($1,$2,'Payment Information Update','Additional Information Required') RETURNING finance_record_id`,
    [cid.karabo, karaboFinanceRef]
  );
  await indexApplication({
    citizenKey: 'karabo', deptKey: 'finance', serviceType: 'Payment Information Update',
    referenceNumber: karaboFinanceRef, sourceTable: 'finance_records', sourceId: fin2[0].finance_record_id,
    status: 'Additional Information Required', submittedAt: new Date(Date.now() - 6 * 86400000),
  });

  // === PENSIONS ================================================================================

  const litsoaneloPensionRef = ref('PEN', 2026, 1);
  const { rows: pen1 } = await client.query(
    `INSERT INTO pension_records (citizen_id, application_reference, service_type, life_status, status)
     VALUES ($1,$2,'Proof of Life Verification','Alive','Completed') RETURNING pension_record_id`,
    [cid.litsoanelo, litsoaneloPensionRef]
  );
  await indexApplication({
    citizenKey: 'litsoanelo', deptKey: 'pensions', serviceType: 'Proof of Life Verification',
    referenceNumber: litsoaneloPensionRef, sourceTable: 'pension_records', sourceId: pen1[0].pension_record_id,
    status: 'Completed', submittedAt: new Date(Date.now() - 30 * 86400000), completedAt: new Date(Date.now() - 28 * 86400000),
  });

  // Mamosa — mistakenly flagged, needs correction (demonstrates the correction path explicitly)
  const mamosaPensionRef = ref('PEN', 2026, 2);
  const { rows: pen2 } = await client.query(
    `INSERT INTO pension_records (citizen_id, application_reference, service_type, life_status, status)
     VALUES ($1,$2,'Proof of Life Verification','Alive','Flagged for Correction') RETURNING pension_record_id`,
    [cid.mamosa, mamosaPensionRef]
  );
  const mamosaPenAppId = await indexApplication({
    citizenKey: 'mamosa', deptKey: 'pensions', serviceType: 'Proof of Life Verification',
    referenceNumber: mamosaPensionRef, sourceTable: 'pension_records', sourceId: pen2[0].pension_record_id,
    status: 'Flagged for Correction', submittedAt: new Date(Date.now() - 9 * 86400000),
  });
  await audit({ userId: uid.officerPensions, deptKey: 'pensions', action: 'PENSION_BENEFICIARY_FLAGGED',
    targetType: 'pension_record', targetId: pen2[0].pension_record_id,
    reason: 'Automated proof-of-life match failed; requires manual correction review.' });

  // === POLICE ===================================================================================

  const karaboLookupRef = ref('PL', 2026, 1);
  const { rows: pol1 } = await client.query(
    `INSERT INTO police_records (citizen_id, officer_user_id, lookup_reference, purpose,
        provided_name, verification_result, case_reference, status)
     VALUES ($1,$2,$3,'Roadside identity check — subject unable to produce ID card','Karabo Foso',
             'Match Found','CASE-2026-0042','Completed')
     RETURNING police_record_id`,
    [cid.karabo, uid.officerPolice, karaboLookupRef]
  );
  await audit({ userId: uid.officerPolice, deptKey: 'police', action: 'POLICE_IDENTITY_LOOKUP',
    targetType: 'citizen', targetId: cid.karabo,
    reason: 'Roadside identity check — subject unable to produce ID card',
    metadata: { lookup_reference: karaboLookupRef, result: 'Match Found' } });

  // A lookup with no match, to demonstrate that outcome too
  const noMatchLookupRef = ref('PL', 2026, 2);
  await client.query(
    `INSERT INTO police_records (officer_user_id, lookup_reference, purpose, provided_name,
        verification_result, case_reference, status)
     VALUES ($1,$2,'Suspect provided a name with no matching Home Affairs record','Thabang Molise',
             'No Match','CASE-2026-0051','Completed')`,
    [uid.officerPolice, noMatchLookupRef]
  );
  await audit({ userId: uid.officerPolice, deptKey: 'police', action: 'POLICE_IDENTITY_LOOKUP',
    targetType: 'citizen', targetId: null,
    reason: 'Suspect provided a name with no matching Home Affairs record',
    metadata: { lookup_reference: noMatchLookupRef, result: 'No Match' } });

  // === Additional notifications / cross-cutting ==============================================

  await notify({ userId: uid.thabo, title: 'Vehicle registration processing',
    message: `Your vehicle registration application ${thaboTrafficRef} is being processed by Traffic.`,
    type: 'Status Change' });
  await notify({ userId: uid.karabo, title: 'Action required: additional payment information',
    message: `Finance requires additional information for application ${karaboFinanceRef}. Please log in to review what is needed.`,
    type: 'Missing Information' });
  await notify({ userId: uid.provisional, title: 'Welcome to the Integrated Government Services portal',
    message: 'Your account has been created. To access most services, please complete Home Affairs identity registration or verification.',
    type: 'System' });
  await notify({ userId: uid.officerHomeAffairsLeribeNew, title: 'Welcome — change your temporary password',
    message: 'Your Branch Administrator created this account for you with a temporary password. You must set your own password before you can use the system.',
    type: 'System' });

  console.log('Seed complete.');
  console.log(`Demo password for all standard seeded accounts: ${DEMO_PASSWORD}`);
  console.log('Forced-password-change demo account: new.officer.homeaffairs.leribe@gov.ls / TempPass2026!  (will require a password change at first login)');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
