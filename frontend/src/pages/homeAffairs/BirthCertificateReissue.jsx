import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import ServiceWorkflowPage from '../../components/ServiceWorkflowPage';

export default function BirthCertificateReissue() {
  const { t } = useLanguage();
  const fields = [
    // NOTE: like deathRecordId used to be on BurialOrder.jsx/DeathCertificateRequest.jsx, this is
    // still a raw internal ID the citizen has no real way to know (see those two files and
    // useApprovedDeathRecords.js for the fix applied there) — not yet fixed here. Flagged
    // `hideFromOfficerDetail` regardless, so the officer's "View details" view at least doesn't
    // show a bare useless number for it.
    { name: 'birthRecordId', label: t('homeAffairs.birthCertificateReissueForm.field.birthRecordId'), type: 'number', required: true, help: t('homeAffairs.birthCertificateReissueForm.field.birthRecordIdHelp'), omitOnResubmit: true, hideFromOfficerDetail: true },
    {
      name: 'reason', label: t('homeAffairs.birthCertificateReissueForm.field.reason'), type: 'select', required: true,
      options: [
        { value: 'Lost', label: t('homeAffairs.reissueReason.Lost') },
        { value: 'Damaged', label: t('homeAffairs.reissueReason.Damaged') },
        { value: 'Never Collected', label: t('homeAffairs.reissueReason.NeverCollected') },
        { value: 'Other', label: t('homeAffairs.reissueReason.Other') },
      ],
    },
    { name: 'details', label: t('homeAffairs.birthCertificateReissueForm.field.details'), type: 'textarea', help: t('common.optional') },
    // Required, and NOT omitted on resubmit — a rejected request can be resubmitted with
    // stronger proof, prefilled from whatever was already uploaded (see ServiceWorkflowPage.jsx's
    // startResubmit, which reads proof_image_reference off the row). A birth certificate never
    // expires, so this whole form is a REISSUE (a replacement copy), never a "renewal" — the
    // citizen must show a reason AND evidence for it, not just pick a reason from a list.
    { name: 'proofImageReference', label: t('homeAffairs.birthCertificateReissueForm.field.proof'), type: 'file', required: true, help: t('homeAffairs.birthCertificateReissueForm.field.proofHelp') },
  ];
  return (
    <ServiceWorkflowPage
      title={t('homeAffairs.birthCertificateReissue')}
      intro={t('homeAffairs.birthCertificateReissueForm.intro')}
      notice={t('homeAffairs.birthCertificateReissueForm.doesNotExpireNotice')}
      apiBase="/home-affairs/birth-certificate-reissue"
      idField="reissue_request_id"
      listKey="reissueRequests"
      singleKey="reissueRequest"
      referenceField="reissue_reference"
      fields={fields}
      resultFields={[{ field: 'birth_certificate_id', label: t('homeAffairs.birthCertificateReissueForm.certificateReady'), linkTo: (id) => `/home-affairs/birth-certificate/${id}` }]}
    />
  );
}
