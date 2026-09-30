const { makeDepartmentController } = require('../utils/simpleDepartmentController');

const controller = makeDepartmentController({
  table: 'traffic_records',
  idColumn: 'traffic_record_id',
  deptKey: 'traffic',
  officerRoleKey: 'traffic_officer',
  refPrefix: 'TR',
  serviceTypes: ['Driving Licence Application', 'Driving Licence Renewal', 'Vehicle Registration', 'Vehicle Transfer', 'Learner Permit'],
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'verify-identity': { from: 'Under Review', to: 'Identity Verified' },
    'check-documents': { from: 'Identity Verified', to: 'Documents Checked' },
    'process': { from: 'Documents Checked', to: 'Processing' },
    'approve': {
      from: 'Processing', to: 'Approved',
      extra: (record) => {
        const isLicence = record.service_type.includes('Licence') || record.service_type.includes('Permit');
        const generated = (isLicence ? 'DL-' : 'LSB-') + String(Math.floor(100000 + Math.random() * 900000));
        return isLicence
          ? { setSql: 'licence_number = $3, issue_date = CURRENT_DATE, expiry_date = CURRENT_DATE + INTERVAL \'5 years\'', params: [generated] }
          : { setSql: 'vehicle_registration_number = $3, issue_date = CURRENT_DATE', params: [generated] };
      },
    },
    'ready-for-collection': { from: 'Approved', to: 'Ready for Collection' },
    'collect': { from: 'Ready for Collection', to: 'Collected' },
  },
});

module.exports = controller;
