import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const TRANSITIONS = {
  'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
  'Under Review': { action: 'complete', labelKey: 'status.Completed' },
};

export default function PoliceInformationRequest() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/police/reports',
    idColumn: 'report_id',
    titleKey: 'police.reports.information.title',
    serviceTypeNs: 'police.reports',
    officerRoleKey: 'police_officer',
    departmentKey: 'police',
    serviceTypes: ['Police Information Request'],
    extraFields: [
      { name: 'description', type: 'textarea', required: true, label: t('police.reports.field.description') },
    ],
    transitions: TRANSITIONS,
  };
  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        {t('police.reports.information.intro')}{' '}
        <Link to="/police/information" className="font-medium text-gov-navy hover:underline">{t('police.information.title')}</Link>
      </p>
      <DepartmentServicePage config={config} />
    </div>
  );
}
