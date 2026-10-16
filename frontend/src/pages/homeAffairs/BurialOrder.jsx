import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import ServiceWorkflowPage from '../../components/ServiceWorkflowPage';
import { useApprovedDeathRecords } from '../../hooks/useApprovedDeathRecords';

export default function BurialOrder() {
  const { t } = useLanguage();
  // Which death record this request is for used to be a plain number box the citizen had to
  // fill in themselves — but the only thing they're ever shown for a death registration is its
  // reference (e.g. "DR-..."), never the internal ID the backend actually looks up by, so there
  // was no way to fill it in correctly. This now offers a dropdown of their own approved death
  // registrations instead — see useApprovedDeathRecords.js for the detail.
  const { options: deathRecordOptions, loading: deathRecordsLoading } = useApprovedDeathRecords();
  const deathRecordHelp = deathRecordsLoading
    ? t('homeAffairs.burialOrderForm.field.deathRecordIdLoading')
    : deathRecordOptions.length === 0
      ? t('homeAffairs.burialOrderForm.field.deathRecordIdEmpty')
      : t('homeAffairs.burialOrderForm.field.deathRecordIdHelp');
  const fields = [
    {
      name: 'deathRecordId', label: t('homeAffairs.burialOrderForm.field.deathRecordId'), type: 'select', required: true,
      options: deathRecordOptions, help: deathRecordHelp, omitOnResubmit: true, hideFromOfficerDetail: true,
    },
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