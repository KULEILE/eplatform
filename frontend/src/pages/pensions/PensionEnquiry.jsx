import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import EnquiryPage from '../../components/EnquiryPage';

/** Pension enquiry and tracking — backend: POST /api/pensions/apply (serviceType
 *  'Pension Status Enquiry' + enquiryText) and POST /api/pensions/:id/respond for the answer. */
export default function PensionEnquiry() {
  const { t } = useLanguage();
  return (
    <div>
      <p className="mb-4 text-sm">
        <Link to="/pensions" className="font-medium text-gov-navy hover:underline">&larr; {t('pensions.title')}</Link>
      </p>
      <EnquiryPage
        apiBase="/pensions"
        idColumn="pension_record_id"
        officerRoleKey="pensions_officer"
        serviceType="Pension Status Enquiry"
        ns="pensions.enquiry"
        textField={{ name: 'enquiryText', column: 'enquiry_text' }}
      />
    </div>
  );
}
