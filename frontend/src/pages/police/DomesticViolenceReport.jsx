import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const TRANSITIONS = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'complete', labelKey: 'status.Completed' },
};

/** needsImmediateAssistance is stored as a nullable boolean column (see migration 055) — sent
 *  here as the string 'true'/'false', which Postgres accepts directly for a boolean column, so
 *  there's no special-casing needed in the generic apply()/resubmit() paths. */
export default function DomesticViolenceReport() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/police/reports',
    idColumn: 'report_id',
    titleKey: 'police.reports.domesticViolence.title',
    serviceTypeNs: 'police.reports',
    officerRoleKey: 'police_officer',
    departmentKey: 'police',
    serviceTypes: ['Domestic Violence Reporting'],
    extraFields: [
      {
        name: 'needsImmediateAssistance', type: 'select', required: true,
        label: t('police.reports.field.needsImmediateAssistance'),
        options: [
          { value: 'true', label: t('police.reports.field.yes') },
          { value: 'false', label: t('police.reports.field.no') },
        ],
      },
      { name: 'incidentDate', type: 'date', label: t('police.reports.field.incidentDate') },
      { name: 'location', type: 'text', label: t('police.reports.field.location') },
      { name: 'description', type: 'textarea', required: true, label: t('police.reports.field.description') },
    ],
    transitions: TRANSITIONS,
  };
  return (
    <div>
      <p className="mb-2 text-sm text-slate-500">{t('police.reports.domesticViolence.intro')}</p>
      <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-gov-amber" role="note">
        ⚠ {t('police.reports.domesticViolence.safetyNotice')}
      </p>
      <DepartmentServicePage config={config} />
    </div>
  );
}
