import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import ServiceWorkflowPage from '../../components/ServiceWorkflowPage';

export default function SpecialMarriageLicence() {
  const { t } = useLanguage();
  const fields = [
    { name: 'spouse1Name', label: t('homeAffairs.specialLicenceForm.field.spouse1Name'), type: 'text', required: true, omitOnResubmit: true },
    { name: 'spouse1PermanentIdentityNumber', label: t('homeAffairs.specialLicenceForm.field.spouse1Id'), type: 'text', help: t('common.optional'), omitOnResubmit: true },
    { name: 'spouse2Name', label: t('homeAffairs.specialLicenceForm.field.spouse2Name'), type: 'text', required: true },
    { name: 'spouse2Nationality', label: t('homeAffairs.specialLicenceForm.field.spouse2Nationality'), type: 'text', help: t('common.optional') },
    { name: 'spouse2PermanentIdentityNumber', label: t('homeAffairs.specialLicenceForm.field.spouse2Id'), type: 'text', help: t('common.optional') },
    {
      name: 'specialReason', label: t('homeAffairs.specialLicenceForm.field.specialReason'), type: 'select', required: true,
      options: [
        { value: 'Foreign National Spouse', label: t('homeAffairs.specialLicenceReason.foreign') },
        { value: 'Urgent / Expedited', label: t('homeAffairs.specialLicenceReason.urgent') },
        { value: 'Minor With Consent', label: t('homeAffairs.specialLicenceReason.minor') },
        { value: 'Other', label: t('homeAffairs.reissueReason.Other') },
      ],
    },
    { name: 'reasonDetails', label: t('homeAffairs.specialLicenceForm.field.reasonDetails'), type: 'textarea', required: true },
  ];
  return (
    <ServiceWorkflowPage
      title={t('homeAffairs.specialLicence')}
      intro={t('homeAffairs.specialLicenceForm.intro')}
      apiBase="/home-affairs/special-marriage-licence"
      idField="licence_request_id"
      listKey="licenceRequests"
      singleKey="licenceRequest"
      referenceField="licence_reference"
      fields={fields}
      columns={[{ key: 'spouses', header: t('homeAffairs.specialLicenceForm.spouses'), render: (r) => `${r.spouse1_name} & ${r.spouse2_name}` }]}
      resultFields={[{ field: 'licence_number', label: t('homeAffairs.specialLicenceForm.licenceNumber') }]}
    />
  );
}
