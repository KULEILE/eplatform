import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

/**
 * "← Back to <department>" link (Batch 4). Before this, once a citizen picked a specific Home
 * Affairs service from the hub, the only way out was navigating to the department menu again by
 * hand — there was no link back. Scoped to Home Affairs for this batch, since that's the
 * department every service discussed and changed here belongs to; the same component can be
 * reused for another department's pages later by passing a different departmentKey/to.
 */
export default function BackToDepartment({ departmentKey = 'home_affairs', to = '/home-affairs' }) {
  const { t } = useLanguage();
  return (
    <Link to={to} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gov-navy hover:underline">
      ← {t('common.backTo', { department: t(`departments.${departmentKey}`) })}
    </Link>
  );
}
