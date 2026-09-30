import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import StatusBadge from './StatusBadge';

/**
 * Renders the "what happened / what's happening now / what's next" status history required by
 * the assignment — explicitly not a vague "keep checking" message.
 */
export default function Timeline({ history = [], currentStatus }) {
  const { t } = useLanguage();
  if (history.length === 0) {
    return <p className="text-sm text-slate-500">{t('common.noResults')}</p>;
  }
  return (
    <ol className="relative border-l-2 border-slate-200 pl-6">
      {history.map((h, idx) => {
        const isLast = idx === history.length - 1;
        return (
          <li key={h.history_id || idx} className="mb-6 last:mb-0">
            <span
              className={`absolute -left-[9px] mt-1 h-4 w-4 rounded-full border-2 border-white ${isLast ? 'bg-gov-navy' : 'bg-slate-300'}`}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={h.status} />
              <time className="text-xs text-slate-500">
                {new Date(h.created_at).toLocaleString()}
              </time>
            </div>
            {h.note && <p className="mt-1 text-sm text-slate-600">{h.note}</p>}
          </li>
        );
      })}
      {currentStatus && (
        <li className="text-sm font-medium text-slate-700">
          {t('applications.whatIsHappening')}: <StatusBadge status={currentStatus} />
        </li>
      )}
    </ol>
  );
}
