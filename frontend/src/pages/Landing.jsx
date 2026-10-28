import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  MagnifyingGlassIcon, DocumentTextIcon, BellIcon, LifebuoyIcon,
  LockClosedIcon, ClockIcon, ShieldCheckIcon, UsersIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useSystemSettings } from '../context/SystemSettingsContext';
import DepartmentCard from '../components/DepartmentCard';
import LesothoFlag from '../components/ui/LesothoFlag';
import { HeroBackdrop, FlagOnPole } from '../components/ui/HeroBackdrop';
import { api } from '../api/client';

const ALL_DEPARTMENTS = ['home_affairs', 'traffic', 'finance', 'pensions', 'police', 'passport'];

export default function Landing() {
  const { user, initializing } = useAuth();
  const { t } = useLanguage();
  const { settings } = useSystemSettings();
  const [query, setQuery] = useState('');
  const [systemOnline, setSystemOnline] = useState(null);

  useEffect(() => {
    api.get('/health').then(() => setSystemOnline(true)).catch(() => setSystemOnline(false));
  }, []);

  if (!initializing && user) return <Navigate to="/dashboard" replace />;

  const visible = ALL_DEPARTMENTS.filter((d) => {
    if (!query.trim()) return true;
    const haystack = `${t(`departments.${d}`)} ${t(`departments.${d}_desc`)}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-hero-gradient text-white shadow-header">
        <HeroBackdrop className="pointer-events-none absolute inset-0 h-full w-full" />
        
        <div className="relative z-10 mx-auto max-w-3xl px-6 py-14 text-center sm:px-10">
          <div className="mb-4 flex items-center justify-center gap-2">
            <LesothoFlag className="h-4 w-7 rounded-sm ring-1 ring-white/30" />
            <span className="eyebrow text-white/70">{t('common.welcomeTo')}</span>
          </div>
          <h1 className="text-3xl font-bold drop-shadow-sm sm:text-4xl">{settings.system_name || t('common.appNameFallback')}</h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-white/80">{t('common.landingSubtitle')}</p>

          <form
            onSubmit={(e) => e.preventDefault()}
            className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-full bg-white p-1.5 shadow-lg"
            role="search"
          >
            <MagnifyingGlassIcon className="ml-2 h-5 w-5 shrink-0 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('common.searchPlaceholder')}
              aria-label={t('common.searchPlaceholder')}
              className="w-full min-w-0 border-0 bg-transparent px-1 py-2 text-sm text-slate-800 focus:outline-none focus:ring-0"
            />
            <button type="submit" className="btn-primary rounded-full px-5">{t('common.search')}</button>
          </form>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/login" className="btn-secondary !border-white/30 !bg-white/10 !text-white hover:!bg-white/20">{t('nav.login')}</Link>
            <Link to="/register" className="inline-flex items-center justify-center gap-2 rounded-md bg-gov-goldLight px-4 py-2.5 text-sm font-semibold text-gov-navyDark shadow-sm transition hover:brightness-105">
              {t('auth.createAccountTitle')}
            </Link>
          </div>
        </div>
      </section>

      {/* Quick actions strip */}
      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link to="/login" className="card-link flex items-center gap-3">
          <DocumentTextIcon className="h-6 w-6 shrink-0 text-gov-navy" strokeWidth={1.6} />
          <span>
            <span className="block text-sm font-semibold text-slate-900">{t('dashboard.trackApplication')}</span>
            <span className="block text-xs text-slate-500">{t('dashboard.trackApplicationDesc')}</span>
          </span>
        </Link>
        <Link to="/login" className="card-link flex items-center gap-3">
          <BellIcon className="h-6 w-6 shrink-0 text-gov-navy" strokeWidth={1.6} />
          <span>
            <span className="block text-sm font-semibold text-slate-900">{t('nav.notifications')}</span>
            <span className="block text-xs text-slate-500">{t('dashboard.viewNotificationsDesc')}</span>
          </span>
        </Link>
        <Link to="/help" className="card-link flex items-center gap-3">
          <LifebuoyIcon className="h-6 w-6 shrink-0 text-gov-navy" strokeWidth={1.6} />
          <span>
            <span className="block text-sm font-semibold text-slate-900">{t('dashboard.needHelp')}</span>
            <span className="block text-xs text-slate-500">{t('dashboard.needHelpDesc')}</span>
          </span>
        </Link>
        <div className="card flex items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${systemOnline ? 'bg-emerald-500' : systemOnline === false ? 'bg-gov-red' : 'bg-slate-300'}`} aria-hidden="true" />
          <span>
            <span className="block text-sm font-semibold text-slate-900">{t('common.systemStatus')}</span>
            <span className="block text-xs text-slate-500">
              {systemOnline === null ? t('common.checking') : systemOnline ? t('common.allSystemsOperational') : t('common.systemUnreachable')}
            </span>
          </span>
        </div>
      </section>

      {/* How it works — a short walkthrough for a first-time visitor who has never used the
          portal before. The full version, with more detail per step, lives at /help. */}
      <section className="mt-10">
        <h2 className="section-title">{t('landingExtra.howItWorksTitle')}</h2>
        <ol className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(t('landingExtra.howItWorksSteps') || []).map((step, i) => (
            <li key={i} className="card relative pt-8">
              <span className="absolute -top-3 left-4 flex h-7 w-7 items-center justify-center rounded-full bg-gov-navy text-xs font-bold text-white shadow-sm">{i + 1}</span>
              <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-1 text-xs text-slate-600">{step.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Departments */}
      <section className="mt-10">
        <h2 className="section-title">{t('dashboard.governmentDepartments')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('landingExtra.departmentsOverview')}</p>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((d) => <DepartmentCard key={d} departmentKey={d} />)}
        </div>
        {visible.length === 0 && <p className="mt-4 text-sm text-slate-500">{t('common.noMatchingService')}</p>}
      </section>

      {/* Trust & security — the same four words shown as bare badges in the footer on every
          page, explained properly here once, for a visitor who hasn't decided yet whether to
          trust this portal with their identity. */}
      <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8">
        <h2 className="section-title text-center">{t('landingExtra.trustTitle')}</h2>
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {(t('landingExtra.trustItems') || []).map((item, i) => {
            const Icon = [LockClosedIcon, ClockIcon, ShieldCheckIcon, UsersIcon][i % 4];
            return (
              <div key={i} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy"><Icon className="h-5 w-5" strokeWidth={1.75} /></span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-0.5 text-sm text-slate-600">{item.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}