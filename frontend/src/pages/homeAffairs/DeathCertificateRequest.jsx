import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import ServiceWorkflowPage from '../../components/ServiceWorkflowPage';

export default function DeathCertificateRequest() {
  const { t } = useLanguage();
  const fields = [
    { name: 'deathRecordId', label: t('homeAffairs.deathCertificateRequestForm.field.deathRecordId'), type: 'number', required: true, help: t('homeAffairs.deathCertificateRequestForm.field.deathRecordIdHelp'), omitOnResubmit: true },
    { name: 'relationshipToDeceased', label: t('homeAffairs.deathCertificateRequestForm.field.relationship'), type: 'text', required: true },
    {
      name: 'reason', label: t('homeAffairs.deathCertificateRequestForm.field.reason'), type: 'select', required: true,
      options: [
        { value: 'Estate / Inheritance', label: t('homeAffairs.deathCertificateReason.estate') },
        { value: 'Insurance Claim', label: t('homeAffairs.deathCertificateReason.insurance') },
        { value: 'Personal Record', label: t('homeAffairs.deathCertificateReason.personal') },
        { value: 'Other', label: t('homeAffairs.reissueReason.Other') },
      ],
    },
    { name: 'details', label: t('homeAffairs.deathCertificateRequestForm.field.details'), type: 'textarea', help: t('common.optional') },
  ];
  return (
    <ServiceWorkflowPage
      title={t('homeAffairs.deathCertificateRequest')}
      intro={t('homeAffairs.deathCertificateRequestForm.intro')}
      apiBase="/home-affairs/death-certificate-request"
      idField="death_certificate_request_id"
      listKey="deathCertificateRequests"
      singleKey="deathCertificateRequest"
      referenceField="request_reference"
      fields={fields}
      columns={[{ key: 'deceased', header: t('homeAffairs.deathCertificateRequestForm.deceased'), render: (r) => `${r.deceased_first_name || ''} ${r.deceased_last_name || ''}`.trim() || '—' }]}
    />
  );
}
