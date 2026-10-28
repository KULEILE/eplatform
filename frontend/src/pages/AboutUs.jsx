import React from 'react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../context/LanguageContext';

export default function AboutUs() {
  const { t } = useLanguage();
  const sections = t('about.sections') || [];

  return (
    <div>
      <section className="relative overflow-hidden rounded-2xl bg-hero-gradient text-white shadow-header">
        <div className="absolute inset-x-0 top-0 h-1 bg-gov-gold" aria-hidden="true" />
        <div className="relative z-10 px-6 py-10 text-center sm:px-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
            <InformationCircleIcon className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <h1 className="mt-3 text-2xl font-bold drop-shadow-sm sm:text-3xl">{t('about.pageTitle')}</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/80">{t('about.intro')}</p>
        </div>
      </section>

      <div className="mx-auto mt-8 max-w-2xl space-y-6">
        {sections.map((s, i) => (
          <div key={i} className="card">
            <h2 className="text-base font-semibold text-slate-900">{s.heading}</h2>
            <p className="mt-1.5 text-sm text-slate-600">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
