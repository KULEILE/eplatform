import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

export default function Loading({ label }) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center gap-3 py-10 text-slate-500" role="status" aria-live="polite">
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-gov-navy"
        aria-hidden="true"
      />
      <span>{label || t('common.loading')}</span>
    </div>
  );
}
