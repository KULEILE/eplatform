import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

// Never colour-only: every badge pairs a colour with an icon AND the text label (WCAG 1.4.1).
const STYLES = {
  positive: { className: 'bg-green-50 text-gov-green border-green-200', icon: '✓' },
  warning: { className: 'bg-amber-50 text-gov-amber border-amber-200', icon: '⚠' },
  negative: { className: 'bg-red-50 text-gov-red border-red-200', icon: '✕' },
  neutral: { className: 'bg-slate-100 text-slate-700 border-slate-300', icon: '•' },
  info: { className: 'bg-blue-50 text-blue-800 border-blue-200', icon: 'ℹ' },
};

const STATUS_KIND = {
  'Draft': 'neutral', 'Submitted': 'info', 'Under Review': 'info',
  'Information Required': 'warning', 'Additional Information Required': 'warning',
  'Verification in Progress': 'info', 'Identity Verified': 'positive', 'Verified': 'positive',
  'Documents Checked': 'info', 'Processing': 'info', 'Approved': 'positive',
  'Rejected': 'negative', 'Certificate Generated': 'positive', 'Card Production': 'info',
  'Passport Produced': 'info', 'Ready for Collection': 'positive', 'Collected': 'positive',
  'Completed': 'positive', 'Flagged for Correction': 'warning', 'Application Submitted': 'info',
  'Active': 'positive', 'Suspended': 'warning', 'Deactivated': 'negative',
  'Match Found': 'positive', 'No Match': 'neutral', 'Possible Mismatch': 'warning',
  'Verified Identity': 'positive', 'Provisional': 'warning',
  'Scheduled': 'info', 'Missed': 'negative', 'Cancelled': 'neutral',
  'Background Check In Progress': 'info',
};

export default function StatusBadge({ status, kind }) {
  const { t } = useLanguage();
  const resolvedKind = kind || STATUS_KIND[status] || 'neutral';
  const style = STYLES[resolvedKind];
  const label = t(`status.${status}`);
  const displayLabel = label === `status.${status}` ? status : label;
  return (
    <span
      className={`status-badge inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${style.className}`}
      role="status"
    >
      <span aria-hidden="true">{style.icon}</span>
      {displayLabel}
    </span>
  );
}
