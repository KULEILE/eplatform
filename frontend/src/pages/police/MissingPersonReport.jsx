import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const TRANSITIONS = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'complete', labelKey: 'status.Completed' },
};

export default function MissingPersonReport() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/police/reports',
    idColumn: 'report_id',
    titleKey: 'police.reports.missingPerson.title',
    serviceTypeNs: 'police.reports',
    officerRoleKey: 'police_officer',
    departmentKey: 'police',
    serviceTypes: ['Missing Person Reporting'],
    extraFields: [
      { name: 'missingPersonName', type: 'text', required: true, label: t('police.reports.field.missingPersonName') },
      { name: 'missingPersonAge', type: 'text', label: t('police.reports.field.missingPersonAge') },
      { name: 'incidentDate', type: 'date', label: t('police.reports.field.incidentDate') },
      { name: 'location', type: 'text', label: t('police.reports.field.location') },
      { name: 'description', type: 'textarea', required: true, label: t('police.reports.field.description') },
      { name: 'evidenceReference', type: 'photo', label: t('police.reports.field.evidence') },
    ],
    transitions: TRANSITIONS,
  };
  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">{t('police.reports.missingPerson.intro')}</p>
      <DepartmentServicePage config={config} />
    </div>
  );
}
