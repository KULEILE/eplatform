import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MagnifyingGlassIcon, LifebuoyIcon, MapIcon, QuestionMarkCircleIcon, BuildingLibraryIcon,
  TruckIcon, BanknotesIcon, UserGroupIcon, ShieldCheckIcon, IdentificationIcon, ArrowUpIcon,
} from '@heroicons/react/24/outline';
import { useLanguage } from '../context/LanguageContext';

// Help Centre — Batch 39. Built against the requirements/approaches a Human-Computer
// Interaction course (BIHC3212, "Help and Documentation") sets out for user support: it should
// be continuously available (a real page, not a modal that blocks the rest of the app), cover
// more than one TYPE of support (quick reference via FAQ search, task-specific help via the
// department guides, and a full explanation via the walkthrough), stay consistent with the rest
// of the portal's design, and — per that same material — be designed as part of the system
// rather than bolted on afterwards, which is why it reuses the exact page shell, icons and
// section pattern already used elsewhere (see Dashboard.jsx's SectionHeader-style sections).
//
// Content source: fixed text in the locale files (help.* in en.json/st.json), per your choice to
// keep this static rather than admin-editable for now — see the batch README for why.

const DEPARTMENT_ICONS = {
  home_affairs: BuildingLibraryIcon,
  traffic: TruckIcon,
  finance: BanknotesIcon,
  pensions: UserGroupIcon,
  police: ShieldCheckIcon,
  passport: IdentificationIcon,
};
const DEPARTMENT_ORDER = ['home_affairs', 'traffic', 'finance', 'pensions', 'police', 'passport'];

function SectionHeader({ icon: Icon, tint = 'navy', title, description }) {
  const TINTS = {
    navy: 'bg-gov-navy/10 text-gov-navy',
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <div className="flex items-start gap-3 border-b border-slate-200 pb-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TINTS[tint]}`} aria-hidden="true">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div>
        <h2 className="text-lg font-bold text-slate-900 sm:text-xl">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
      </div>
    </div>
  );
}

export default function HelpCenter() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');

  const faq = t('help.faq') || [];
  const guides = t('help.guides') || {};
  const walkthroughSteps = t('help.walkthroughSteps') || [];

  const normalizedQuery = query.trim().toLowerCase();
  const filteredFaq = useMemo(() => {
    if (!normalizedQuery) return faq;
    return faq.filter((item) => `${item.category} ${item.q} ${item.a}`.toLowerCase().includes(normalizedQuery));
  }, [faq, normalizedQuery]);

  const faqByCategory = useMemo(() => {
    const map = new Map();
    filteredFaq.forEach((item) => {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category).push(item);
    });
    return map;
  }, [filteredFaq]);

  return (
    <div>
      <section className="relative overflow-hidden rounded-2xl bg-hero-gradient text-white shadow-header">
        <div className="absolute inset-x-0 top-0 h-1 bg-gov-gold" aria-hidden="true" />
        <div className="relative z-10 px-6 py-10 text-center sm:px-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
            <LifebuoyIcon className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <h1 className="mt-3 text-2xl font-bold drop-shadow-sm sm:text-3xl">{t('help.pageTitle')}</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/80">{t('help.pageIntro')}</p>

          <form onSubmit={(e) => e.preventDefault()} className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-full bg-white p-1.5 shadow-lg" role="search">
            <MagnifyingGlassIcon className="ml-2 h-5 w-5 shrink-0 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('help.searchPlaceholder')}
              aria-label={t('help.searchPlaceholder')}
              className="w-full min-w-0 border-0 bg-transparent px-1 py-2 text-sm text-slate-800 focus:outline-none focus:ring-0"
            />
          </form>
        </div>
      </section>

      {/* Quick jump strip */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
        <a href="#walkthrough" className="btn-secondary !px-3 !py-1.5">{t('help.walkthroughTitle')}</a>
        <a href="#faq" className="btn-secondary !px-3 !py-1.5">{t('help.faqTitle')}</a>
        <a href="#guides" className="btn-secondary !px-3 !py-1.5">{t('help.departmentGuidesTitle')}</a>
      </div>

      {/* Walkthrough — the "full explanation" type of help */}
      <section id="walkthrough" className="mt-10 scroll-mt-20">
        <SectionHeader icon={MapIcon} title={t('help.walkthroughTitle')} description={t('help.walkthroughIntro')} />
        <ol className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {walkthroughSteps.map((step, i) => (
            <li key={i} className="card relative pt-8">
              <span className="absolute -top-3 left-4 flex h-7 w-7 items-center justify-center rounded-full bg-gov-navy text-xs font-bold text-white shadow-sm">{i + 1}</span>
              <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-1 text-xs text-slate-600">{step.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ — the "quick reference" type of help, searchable */}
      <section id="faq" className="mt-10 scroll-mt-20">
        <SectionHeader icon={QuestionMarkCircleIcon} tint="blue" title={t('help.faqTitle')} description={t('help.faqIntro')} />
        <div className="mt-5 space-y-8">
          {[...faqByCategory.entries()].map(([category, items]) => (
            <div key={category}>
              <h3 className="eyebrow mb-3 text-gov-navy">{category}</h3>
              <div className="space-y-3">
                {items.map((item, i) => (
                  <details key={i} className="card group" open={!!normalizedQuery}>
                    <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 marker:content-none">
                      <span className="flex items-center justify-between gap-3">
                        {item.q}
                        <span className="shrink-0 text-slate-400 transition group-open:rotate-180">⌄</span>
                      </span>
                    </summary>
                    <p className="mt-2 text-sm text-slate-600">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
          {filteredFaq.length === 0 && <p className="text-sm text-slate-500">{t('help.noResults')}</p>}
        </div>
      </section>

      {/* Department guides — the "task-specific" type of help */}
      <section id="guides" className="mt-10 scroll-mt-20">
        <SectionHeader icon={BuildingLibraryIcon} tint="emerald" title={t('help.departmentGuidesTitle')} description={t('help.departmentGuidesIntro')} />
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {DEPARTMENT_ORDER.map((key) => {
            const Icon = DEPARTMENT_ICONS[key];
            const guide = guides[key];
            if (!guide) return null;
            return (
              <div key={key} className="card">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy"><Icon className="h-5 w-5" strokeWidth={1.75} /></span>
                  <h3 className="text-base font-semibold text-slate-900">{t(`departments.${key}`)}</h3>
                </div>
                <p className="mt-3 text-sm text-slate-600">{guide.intro}</p>
                <ol className="mt-3 space-y-1.5">
                  {guide.steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-700">
                      <span className="shrink-0 font-semibold text-gov-navy">{i + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6 text-center shadow-card">
        <h2 className="text-base font-semibold text-slate-900">{t('help.stillNeedHelp')}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{t('help.stillNeedHelpDesc')}</p>
        <Link to="/contact" className="btn-primary mt-4 inline-flex">{t('help.contactCta')}</Link>
      </section>

      <div className="mt-6 text-center">
        <a href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="inline-flex items-center gap-1 text-sm font-medium text-gov-navy hover:underline">
          <ArrowUpIcon className="h-4 w-4" />{t('help.backToTop')}
        </a>
      </div>
    </div>
  );
}
