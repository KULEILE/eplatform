import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import ServiceWorkflowPage from '../../components/ServiceWorkflowPage';

export default function BurialOrder() {
  const { t } = useLanguage();
  const fields = [
    { name: 'deathRecordId', label: t('homeAffairs.burialOrderForm.field.deathRecordId'), type: 'number', required: true, help: t('homeAffairs.burialOrderForm.field.deathRecordIdHelp'), omitOnResubmit: true },
    { name: 'placeOfBurial', label: t('homeAffairs.burialOrderForm.field.placeOfBurial'), type: 'text', required: true },
    { name: 'cemeteryOrSite', label: t('homeAffairs.burialOrderForm.field.cemeteryOrSite'), type: 'text', help: t('common.optional') },
    { name: 'plannedBurialDate', label: t('homeAffairs.burialOrderForm.field.plannedBurialDate'), type: 'date', required: true },
  ];
  return (
    <ServiceWorkflowPage
      title={t('homeAffairs.burialOrder')}
      intro={t('homeAffairs.burialOrderForm.intro')}
      apiBase="/home-affairs/burial-order"
      idField="burial_order_request_id"
      listKey="burialOrderRequests"
      singleKey="burialOrderRequest"
      referenceField="order_reference"
      fields={fields}
      columns={[{ key: 'deceased', header: t('homeAffairs.deathCertificateRequestForm.deceased'), render: (r) => `${r.deceased_first_name || ''} ${r.deceased_last_name || ''}`.trim() || '—' }]}
      resultFields={[{ field: 'order_number', label: t('homeAffairs.burialOrderForm.orderNumber') }]}
    />
  );
}
