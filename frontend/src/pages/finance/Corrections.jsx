import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import CorrectionsPanel from '../../components/CorrectionsPanel';

export default function FinanceCorrections() {
  const { t } = useLanguage();
  const fields = [
    {
      name: 'government_employment_status', label: t('finance.employment.statusLabel'),
      options: ['Not Applicable', 'Active', 'Retired'].map((v) => ({ value: v, label: t(`finance.employmentStatus.${v}`) })),
    },
    {
      name: 'employee_category', label: t('finance.employment.categoryLabel'),
      options: ['General Civil Servant', 'Uniformed/Disciplined Services'].map((v) => ({ value: v, label: t(`finance.employeeCategory.${v}`) })),
    },
  ];
  return (
    <CorrectionsPanel
      departmentKey="finance"
      officerRoleKey="finance_officer"
      titleKey="finance.correction"
      fields={fields}
    />
  );
}
