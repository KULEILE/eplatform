const { makeDepartmentController } = require('../utils/simpleDepartmentController');

const controller = makeDepartmentController({
  table: 'finance_records',
  idColumn: 'finance_record_id',
  deptKey: 'finance',
  officerRoleKey: 'finance_officer',
  refPrefix: 'FIN',
  serviceTypes: ['Supplier Registration Validation', 'Payment Information Update', 'Tax Identity Confirmation', 'Financial Records Correction'],
  finalStatuses: ['Rejected', 'Completed'],
  statusFlow: {
    'start-review': { from: 'Submitted', to: 'Under Review' },
    'verify-identity': { from: 'Under Review', to: 'Identity Verified' },
    'check-documents': { from: 'Identity Verified', to: 'Documents Checked' },
    'process': { from: 'Documents Checked', to: 'Processing' },
    'complete': {
      from: 'Processing', to: 'Completed',
      extra: () => ({ setSql: `validated_information_note = $3`, params: ['Identity and supporting information validated against Home Affairs and departmental records.'] }),
    },
  },
});

module.exports = controller;
