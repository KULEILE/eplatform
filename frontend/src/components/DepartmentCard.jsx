import React from 'react';
import { Link } from 'react-router-dom';
import {
  BuildingLibraryIcon, TruckIcon, BanknotesIcon, UserGroupIcon, ShieldCheckIcon, IdentificationIcon, ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { useLanguage } from '../context/LanguageContext';

const ICONS = {
  home_affairs: BuildingLibraryIcon,
  traffic: TruckIcon,
  finance: BanknotesIcon,
  pensions: UserGroupIcon,
  police: ShieldCheckIcon,
  passport: IdentificationIcon,
};

const ROUTES = { home_affairs: '/home-affairs', traffic: '/traffic', finance: '/finance', pensions: '/pensions', police: '/police', passport: '/passport' };

// Full literal class names (not string-interpolated) so Tailwind's content scanner picks them up.
const THEME = {
  home_affairs: { wash: 'bg-blue-50/60 hover:bg-blue-50', ring: 'hover:ring-blue-200', circle: 'bg-blue-600', link: 'text-blue-700' },
  traffic:      { wash: 'bg-emerald-50/60 hover:bg-emerald-50', ring: 'hover:ring-emerald-200', circle: 'bg-emerald-600', link: 'text-emerald-700' },
  finance:      { wash: 'bg-amber-50/60 hover:bg-amber-50', ring: 'hover:ring-amber-200', circle: 'bg-amber-500', link: 'text-amber-700' },
  pensions:     { wash: 'bg-violet-50/60 hover:bg-violet-50', ring: 'hover:ring-violet-200', circle: 'bg-violet-600', link: 'text-violet-700' },
  police:       { wash: 'bg-rose-50/60 hover:bg-rose-50', ring: 'hover:ring-rose-200', circle: 'bg-rose-600', link: 'text-rose-700' },
  passport:     { wash: 'bg-teal-50/60 hover:bg-teal-50', ring: 'hover:ring-teal-200', circle: 'bg-teal-600', link: 'text-teal-700' },
};

export default function DepartmentCard({ departmentKey }) {
  const { t } = useLanguage();
  const Icon = ICONS[departmentKey];
  const theme = THEME[departmentKey];

  return (
    <Link
      to={ROUTES[departmentKey]}
      className={`group flex flex-col gap-3 rounded-xl border border-slate-200 p-5 shadow-card ring-1 ring-transparent transition duration-150 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:-translate-y-0.5 ${theme.wash} ${theme.ring}`}
    >
      <div className="flex items-start justify-between">
        <span className={`flex h-12 w-12 items-center justify-center rounded-full text-white shadow-sm ${theme.circle}`} aria-hidden="true">
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </span>
        {departmentKey === 'passport' && (
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-slate-600 shadow-sm">
            {t('departments.groupedUnderHomeAffairs')}
          </span>
        )}
      </div>
      <div>
        <h3 className="text-base font-semibold text-slate-900">{t(`departments.${departmentKey}`)}</h3>
        <p className="mt-1 text-sm text-slate-600">{t(`departments.${departmentKey}_desc`)}</p>
      </div>
      <span className={`mt-1 inline-flex items-center gap-1 text-sm font-semibold ${theme.link}`}>
        {t('common.viewServices')}
        <ChevronRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
