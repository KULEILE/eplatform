import React from 'react';
import { LockClosedIcon, ClockIcon, ShieldCheckIcon, UsersIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../../context/LanguageContext';
import { useSystemSettings } from '../../context/SystemSettingsContext';
import LesothoFlag from '../ui/LesothoFlag';

function TrustBadge({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <Icon className="h-5 w-5 text-gov-navy" strokeWidth={1.6} />
      {label}
    </div>
  );
}

export default function Footer() {
  const { t } = useLanguage();
  const { settings } = useSystemSettings();

  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-5 sm:justify-between">
        <TrustBadge icon={LockClosedIcon} label={t('common.trustSecure')} />
        <TrustBadge icon={ClockIcon} label={t('common.trustConvenient')} />
        <TrustBadge icon={ShieldCheckIcon} label={t('common.trustTransparent')} />
        <TrustBadge icon={UsersIcon} label={t('common.trustCitizenCentred')} />
      </div>
      <div className="border-t border-slate-100 bg-gov-navy text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs">
          <div className="flex items-center gap-2 font-semibold">
            <LesothoFlag className="h-4 w-6 rounded-sm ring-1 ring-white/20" />
            {settings.system_name || t('common.appNameFallback')}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-white/75">
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white hover:underline">{t('common.privacyPolicy')}</a>
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white hover:underline">{t('common.termsOfUse')}</a>
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white hover:underline">{t('common.accessibility')}</a>
            <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-white hover:underline">{t('common.contact')}</a>
          </div>
          <span className="text-white/60">{t('common.footerRights', { year: new Date().getFullYear() })}</span>
        </div>
      </div>
    </footer>
  );
}
