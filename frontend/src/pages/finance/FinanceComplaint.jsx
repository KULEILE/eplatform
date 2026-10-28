import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';

const ISSUE_CATEGORIES = ['Salary Issue', 'Bank Details Issue', 'Pension Issue', 'Supplier Payment Issue', 'Tax Issue', 'Other'];

/** Complaints and enquiries (service #4): "Citizens submit complaints, receive reference
 *  numbers and track responses." Uses config.responseField so the citizen can read the
 *  officer's written reply through the shared 'View details' modal, and the 'respond-complaint'
 *  action's requiresText prompt (see DepartmentServicePage.jsx) to collect that reply.
 *
 *  Batch 40 — "when citizen have issues must select sub finance eg. health, education": an
 *  issue-category dropdown, on top of the complaint text, since this system's six departments
 *  are fixed and "health"/"education" aren't among them (see migration 080). */
export default function FinanceComplaint() {
  const { t } = useLanguage();
  const config = {
    apiBase: '/finance',
    idColumn: 'finance_record_id',
    titleKey: 'finance.complaint.title',
    serviceTypeNs: 'finance',
    officerRoleKey: 'finance_officer',
    departmentKey: 'finance',
    serviceTypes: ['Finance Complaint or Enquiry'],
    extraFields: [
      {
        name: 'issueCategory', type: 'select', required: true, label: t('finance.complaint.field.issueCategory'),
        options: ISSUE_CATEGORIES.map((c) => ({ value: c, label: t(`finance.issueCategory.${c}`) })),
      },
      { name: 'complaintText', type: 'textarea', required: true, label: t('finance.complaint.field.complaintText') },
      { name: 'evidenceReference', type: 'photo', label: t('finance.complaint.field.evidence') },
    ],
    transitions: {
      'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
      'Under Review': { action: 'respond-complaint', labelKey: 'common.respond', requiresText: true, textLabelKey: 'finance.complaint.officerResponseLabel' },
    },
    responseField: { column: 'officer_response', labelKey: 'finance.complaint.officerResponseLabel' },
  };
  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">{t('finance.complaint.intro')}</p>
      <DepartmentServicePage config={config} />
    </div>
  );
}
