import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import EnquiryPage from '../../components/EnquiryPage';

/** Finance complaints and enquiries — backend: POST /api/finance/apply (serviceType
 *  'Finance Complaint or Enquiry') and POST /api/finance/:id/respond for the officer's answer. */
export default function FinanceComplaint() {
  const { t } = useLanguage();
  return (
    <div>
      <p className="mb-4 text-sm">
        <Link to="/finance" className="font-medium text-gov-navy hover:underline">&larr; {t('finance.title')}</Link>
      </p>
      <EnquiryPage
        apiBase="/finance"
        idColumn="finance_record_id"
        officerRoleKey="finance_officer"
        serviceType="Finance Complaint or Enquiry"
        ns="finance.complaint"
        textField={{ name: 'complaintText', column: 'complaint_text' }}
        evidenceField={{ name: 'evidenceReference', column: 'evidence_reference' }}
      />
    </div>
  );
}
