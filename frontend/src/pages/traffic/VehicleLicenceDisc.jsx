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
 *  services ... its renewal they must in one place". A vehicle cannot be licensed without proof
 *  of insurance — enforced server-side. */
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
      fields.push({ name: 'insuranceProofReference', type: 'photo', required: true, label: t('traffic.licenceDiscApplyForm.field.insuranceProof'), help: t('traffic.licenceDiscApplyForm.field.insuranceProofHelp') });
      return fields;
    },
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
