import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const TRANSITIONS = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'check-documents', labelKey: 'status.Documents Checked' },
  'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
  'Processing': { action: 'approve', labelKey: 'common.approve' },
};

export default function TransportPermitRenew() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic/transport-permits',
    idColumn: 'transport_operating_permit_id',
    titleKey: 'traffic.transportPermitRenewForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['Renewal'],
    extraFields: [
      { name: 'vehicleRegistrationNumber', type: 'text', required: true, label: t('traffic.vehicleTransferForm.field.vehicleRegistrationNumber') },
      {
        name: 'permitCategory', type: 'select', required: true,
        label: t('traffic.transportPermitForm.field.category'),
        options: ['A', 'B', 'C', 'D', 'E', 'F'].map((c) => ({ value: c, label: t(`traffic.permitCategory.${c}`) })),
      },
      { name: 'operatingRouteOrArea', type: 'textarea', required: true, label: t('traffic.transportPermitForm.field.route') },
      { name: 'previousPermitNumber', type: 'text', required: true, label: t('traffic.transportPermitRenewForm.field.previousPermitNumber') },
    ],
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
