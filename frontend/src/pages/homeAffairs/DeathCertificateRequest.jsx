import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import ServiceWorkflowPage from '../../components/ServiceWorkflowPage';
import { useApprovedDeathRecords } from '../../hooks/useApprovedDeathRecords';

export default function DeathCertificateRequest() {
  const { t } = useLanguage();
  // See useApprovedDeathRecords.js — same fix as BurialOrder.jsx: this used to be a plain number
  // box asking for an internal ID the citizen had no way to know, now it's a dropdown of their
  // own approved death registrations.
  const { options: deathRecordOptions, loading: deathRecordsLoading } = useApprovedDeathRecords();
  const deathRecordHelp = deathRecordsLoading
    ? t('homeAffairs.deathCertificateRequestForm.field.deathRecordIdLoading')
    : deathRecordOptions.length === 0
      ? t('homeAffairs.deathCertificateRequestForm.field.deathRecordIdEmpty')
      : t('homeAffairs.deathCertificateRequestForm.field.deathRecordIdHelp');
  const fields = [
    {
      name: 'deathRecordId', label: t('homeAffairs.deathCertificateRequestForm.field.deathRecordId'), type: 'select', required: true,
      options: deathRecordOptions, help: deathRecordHelp, omitOnResubmit: true, hideFromOfficerDetail: true,
    },
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
      resultFields={[{
        field: 'certificate_number', label: t('homeAffairs.deathCertificateRequestForm.viewCertificate'),
        linkTo: (value, row) => `/home-affairs/death-certificate/${row.death_certificate_request_id}`,
      }]}
    />
  );
}
