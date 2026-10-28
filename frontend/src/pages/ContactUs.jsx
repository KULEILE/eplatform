import React from 'react';
import { Link } from 'react-router-dom';
import { PhoneIcon, QuestionMarkCircleIcon, BellIcon, InboxStackIcon, MapPinIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../context/LanguageContext';

const ICONS = [QuestionMarkCircleIcon, BellIcon, InboxStackIcon, MapPinIcon];

export default function ContactUs() {
  const { t } = useLanguage();
  const channels = t('contactPage.channels') || [];

  return (
    <div>
      <section className="relative overflow-hidden rounded-2xl bg-hero-gradient text-white shadow-header">
        <div className="absolute inset-x-0 top-0 h-1 bg-gov-gold" aria-hidden="true" />
        <div className="relative z-10 px-6 py-10 text-center sm:px-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
            <PhoneIcon className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <h1 className="mt-3 text-2xl font-bold drop-shadow-sm sm:text-3xl">{t('contactPage.pageTitle')}</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/80">{t('contactPage.intro')}</p>
        </div>
      </section>

      <div className="mx-auto mt-8 max-w-2xl space-y-4">
        {channels.map((c, i) => {
          const Icon = ICONS[i % ICONS.length];
          return (
            <div key={i} className="card flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy"><Icon className="h-5 w-5" strokeWidth={1.75} /></span>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{c.title}</h2>
                <p className="mt-1 text-sm text-slate-600">{c.body}</p>
              </div>
            </div>
          );
        })}

        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          {t('contactPage.prototypeNote')}
        </p>

        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Link to="/help" className="btn-secondary">{t('help.pageTitle')}</Link>
          <Link to="/report-financial-issue" className="btn-primary">{t('finance.reportIssue.title')}</Link>
        </div>
      </div>
    </div>
  );
}
