import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import ServiceWorkflowPage from '../../components/ServiceWorkflowPage';

export default function Adoption() {
  const { t } = useLanguage();
  const fields = [
    { name: 'childPermanentIdentityNumber', label: t('homeAffairs.adoptionForm.field.childId'), type: 'text', required: true, help: t('homeAffairs.adoptionForm.field.childIdHelp'), omitOnResubmit: true },
    { name: 'courtOrderReference', label: t('homeAffairs.adoptionForm.field.courtOrderReference'), type: 'text', required: true },
    { name: 'courtName', label: t('homeAffairs.adoptionForm.field.courtName'), type: 'text', help: t('common.optional') },
    { name: 'adoptionDate', label: t('homeAffairs.adoptionForm.field.adoptionDate'), type: 'date', required: true },
    { name: 'reasonDetails', label: t('homeAffairs.adoptionForm.field.reasonDetails'), type: 'textarea', help: t('common.optional') },
  ];
  return (
    <ServiceWorkflowPage
      title={t('homeAffairs.adoption')}
      intro={t('homeAffairs.adoptionForm.intro')}
      apiBase="/home-affairs/adoption"
      idField="adoption_record_id"
      listKey="adoptionRecords"
      singleKey="adoptionRecord"
      referenceField="registration_reference"
      fields={fields}
      columns={[{ key: 'child', header: t('homeAffairs.adoptionForm.child'), render: (r) => `${r.child_first_name || ''} ${r.child_last_name || ''}`.trim() || '—' }]}
    />
  );
}
