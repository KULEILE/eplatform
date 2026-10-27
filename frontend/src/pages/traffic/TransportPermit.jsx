import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const TRANSITIONS = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'check-documents', labelKey: 'status.Documents Checked' },
  'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
  'Processing': { action: 'approve', labelKey: 'common.approve' },
};

const BASE_FIELDS = (t) => [
  { name: 'vehicleRegistrationNumber', type: 'text', required: true, label: t('traffic.vehicleTransferForm.field.vehicleRegistrationNumber') },
  {
    name: 'permitCategory', type: 'select', required: true,
    label: t('traffic.transportPermitForm.field.category'),
    options: ['A', 'B', 'C', 'D', 'E', 'F'].map((c) => ({ value: c, label: t(`traffic.permitCategory.${c}`) })),
  },
  { name: 'operatingRouteOrArea', type: 'textarea', required: true, label: t('traffic.transportPermitForm.field.route') },
];

/** New or Renewal, one page with a type selector — TransportPermitNew.jsx/TransportPermitRenew.jsx
 *  used to be two separate tiles/pages for what the backend already treats as one resource
 *  (trafficServices2.controller.js's transportPermitsController, serviceTypes ['New','Renewal']) —
 *  same consolidation as Vehicle Registration above, for the same reason: "do not duplicate the
 *  services ... its renewal they must in one place". Requires a valid, unexpired Certificate of
 *  Fitness for the vehicle — a commercial permit cannot be granted for a vehicle that isn't
 *  confirmed roadworthy (checked server-side, now itself gated on a physical inspection — see
 *  trafficServices2.controller.js's vehicleInspectionsController). */
export default function TransportPermit() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/traffic/transport-permits',
    idColumn: 'transport_operating_permit_id',
    titleKey: 'traffic.transportPermitForm.title',
    serviceTypeNs: 'traffic',
    officerRoleKey: 'traffic_officer',
    departmentKey: 'traffic',
    serviceTypes: ['New', 'Renewal'],
    extraFields: (serviceType) => (
      serviceType === 'Renewal'
        ? [...BASE_FIELDS(t), { name: 'previousPermitNumber', type: 'text', required: true, label: t('traffic.transportPermitRenewForm.field.previousPermitNumber') }]
        : BASE_FIELDS(t)
    ),
    transitions: TRANSITIONS,
  };
  return <DepartmentServicePage config={config} />;
}
