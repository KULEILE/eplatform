import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const TRANSITIONS = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
  'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
  'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
  'Processing': { action: 'approve', labelKey: 'common.approve' },
  'Approved': { action: 'ready-for-collection', labelKey: 'common.readyForCollection' },
  'Ready for Collection': { action: 'collect', labelKey: 'common.collect' },
};

/** Application or Renewal, one page with a type selector — VehicleLicenceDiscApply.jsx/
 *  VehicleLicenceDiscRenew.jsx used to be two separate tiles/pages for the same underlying
 *  service_type pair ('Vehicle Licence Disc Application'/'Renewal', migration 042) — same
 *  consolidation as Vehicle Registration and Transport Permit above: "do not duplicate the
 *  services ... its renewal they must in one place".
 *
 * Batch 33 — "in Lesotho proof of insurance is not required when applying for disc so remove
 * that": private motor insurance was researched and is not actually required to license a
 * vehicle in Lesotho in practice (Lesotho runs a fund-based third-party compensation model, the
 * same as South Africa's RAF, rather than requiring individual private policies — see the Batch
 * 33 README), so this requirement never matched how the real process works and is removed
 * entirely, both here and in traffic.controller.js's beforeApply. insurance_proof_reference stays
 * in the database (migration 042) so any already-submitted record that has one keeps it — this
 * only stops asking for it going forward. */
export default function VehicleLicenceDisc() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic',
    idColumn: 'traffic_record_id',
    titleKey: 'traffic.licenceDiscApplyForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Vehicle Licence Disc Application', 'Vehicle Licence Disc Renewal'],
    extraFields: (serviceType) => {
      const fields = [
        { name: 'vehicleRegistrationNumber', type: 'text', required: true, label: t('traffic.vehicleTransferForm.field.vehicleRegistrationNumber') },
      ];
      if (serviceType === 'Vehicle Licence Disc Renewal') {
        fields.push({ name: 'previousDiscNumber', type: 'text', required: true, label: t('traffic.licenceDiscRenewForm.field.previousDiscNumber') });
      }
      return fields;
    },
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
