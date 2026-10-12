import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import ServiceWorkflowPage from '../../components/ServiceWorkflowPage';

export default function NameChange() {
  const { t } = useLanguage();
  const fields = [
    { name: 'requestedFirstName', label: t('homeAffairs.nameChangeForm.field.requestedFirstName'), type: 'text', required: true },
    { name: 'requestedLastName', label: t('homeAffairs.nameChangeForm.field.requestedLastName'), type: 'text', required: true },
    {
      name: 'reasonCategory', label: t('homeAffairs.nameChangeForm.field.reasonCategory'), type: 'select', required: true,
      options: [
        { value: 'Marriage', label: t('homeAffairs.nameChangeReason.marriage') },
        { value: 'Divorce', label: t('homeAffairs.nameChangeReason.divorce') },
        { value: 'Personal Preference', label: t('homeAffairs.nameChangeReason.preference') },
        { value: 'Religious', label: t('homeAffairs.nameChangeReason.religious') },
        { value: 'Correction of Error', label: t('homeAffairs.nameChangeReason.correction') },
        { value: 'Other', label: t('homeAffairs.reissueReason.Other') },
      ],
    },
    { name: 'reasonDetails', label: t('homeAffairs.nameChangeForm.field.reasonDetails'), type: 'textarea', required: true },
  ];
  return (
    <ServiceWorkflowPage
      title={t('homeAffairs.nameChange')}
      intro={t('homeAffairs.nameChangeForm.intro')}
      apiBase="/home-affairs/name-change"
      idField="name_change_request_id"
      listKey="nameChangeRequests"
      singleKey="nameChangeRequest"
      referenceField="request_reference"
      fields={fields}
      columns={[{ key: 'requested', header: t('homeAffairs.nameChangeForm.requestedName'), render: (r) => `${r.requested_first_name} ${r.requested_last_name}` }]}
      resultFields={[{ field: 'approval_reference', label: t('homeAffairs.nameChangeForm.approvalReference') }]}
    />
  );
}
