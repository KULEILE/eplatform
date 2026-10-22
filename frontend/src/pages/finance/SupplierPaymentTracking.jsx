import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import DepartmentServicePage from '../../components/DepartmentServicePage';
import { formatDateOnly } from '../../utils/format';

const SERVICE_TYPE = 'Government Supplier Payment Tracking';

/**
 * A supplier submits an invoice for a government payment and tracks it until it is paid.
 * Backend: finance.controller.js — same finance_records table and review steps as the other
 * Finance services, but it ends with 'Mark as paid' (status 'Paid') instead of 'Completed'.
 */
export default function SupplierPaymentTracking() {
  const { t } = useLanguage();

  const config = {
    apiBase: '/finance',
    idColumn: 'finance_record_id',
    titleKey: 'finance.supplierPayment.title',
    introKey: 'finance.supplierPayment.intro',
    serviceTypeNs: 'finance',
    officerRoleKey: 'finance_officer',
    serviceTypes: [SERVICE_TYPE],
    listFilter: (r) => r.service_type === SERVICE_TYPE,
    finalStatuses: ['Rejected', 'Completed', 'Paid'],
    extraFields: [
      { name: 'supplierName', type: 'text', required: true, label: t('finance.supplierPayment.field.supplierName') },
      { name: 'invoiceNumber', type: 'text', required: true, label: t('finance.supplierPayment.field.invoiceNumber') },
      { name: 'invoiceAmount', type: 'number', required: true, label: t('finance.supplierPayment.field.invoiceAmount') },
      { name: 'invoiceDate', type: 'date', required: true, label: t('finance.supplierPayment.field.invoiceDate') },
      { name: 'evidenceReference', type: 'photo', required: false, label: t('finance.supplierPayment.field.evidence') },
    ],
    extraColumns: [
      { key: 'supplier_name', header: t('finance.supplierPayment.field.supplierName'), render: (r) => r.supplier_name || '—' },
      { key: 'invoice_number', header: t('finance.supplierPayment.field.invoiceNumber'), render: (r) => r.invoice_number || '—' },
      {
        key: 'invoice_amount', header: t('finance.supplierPayment.field.invoiceAmount'),
        render: (r) => (r.invoice_amount != null ? Number(r.invoice_amount).toLocaleString('en-ZA', { minimumFractionDigits: 2 }) : '—'),
      },
      { key: 'invoice_date', header: t('finance.supplierPayment.field.invoiceDate'), render: (r) => formatDateOnly(r.invoice_date) },
      {
        key: 'evidence_reference', header: t('finance.supplierPayment.field.evidence'),
        render: (r) => (r.evidence_reference
          ? <a href={`/uploads/${r.evidence_reference}`} target="_blank" rel="noreferrer" className="text-gov-navy underline">{t('common.viewDetails')}</a>
          : '—'),
      },
    ],
    transitions: {
      'Submitted': { action: 'start-review', labelKey: 'status.Under Review' },
      'Under Review': { action: 'verify-identity', labelKey: 'status.Identity Verified' },
      'Identity Verified': { action: 'check-documents', labelKey: 'status.Documents Checked' },
      'Documents Checked': { action: 'process', labelKey: 'status.Processing' },
      'Processing': { action: 'mark-paid', labelKey: 'finance.markPaid' },
    },
  };

  return (
    <div>
      <p className="mb-4 text-sm">
        <Link to="/finance" className="font-medium text-gov-navy hover:underline">&larr; {t('finance.title')}</Link>
      </p>
      <DepartmentServicePage config={config} />
    </div>
  );
}
