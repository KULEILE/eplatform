import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircleIcon, DocumentTextIcon, BellIcon, LifebuoyIcon, UserPlusIcon, BuildingOffice2Icon,
  UsersIcon, Cog6ToothIcon, ClipboardDocumentListIcon, RectangleGroupIcon, InboxStackIcon, ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import DepartmentCard from '../components/DepartmentCard';
import Loading from '../components/ui/Loading';
import { HeroBackdrop, FlagOnPole } from '../components/ui/HeroBackdrop';

const DEPARTMENTS = ['home_affairs', 'traffic', 'finance', 'pensions', 'police', 'passport'];
const DEPARTMENT_ROUTES = { home_affairs: '/home-affairs', traffic: '/traffic', finance: '/finance', pensions: '/pensions', police: '/police', passport: '/passport' };

function maskPin(pin) {
  if (!pin) return '';
  return pin.slice(0, -4).replace(/./g, '•') + pin.slice(-4);
}

function QuickActionsStrip({ t, systemOnline }) {
  return (
    <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Link to="/applications" className="card-link flex items-center gap-3">
        <DocumentTextIcon className="h-6 w-6 shrink-0 text-gov-navy" strokeWidth={1.6} />
        <span>
          <span className="block text-sm font-semibold text-slate-900">{t('dashboard.trackApplication')}</span>
          <span className="block text-xs text-slate-500">{t('dashboard.trackApplicationDesc')}</span>
        </span>
      </Link>
      <Link to="/notifications" className="card-link flex items-center gap-3">
        <BellIcon className="h-6 w-6 shrink-0 text-gov-navy" strokeWidth={1.6} />
        <span>
          <span className="block text-sm font-semibold text-slate-900">{t('nav.notifications')}</span>
          <span className="block text-xs text-slate-500">{t('dashboard.viewNotificationsDesc')}</span>
        </span>
      </Link>
      <a href="#" onClick={(e) => e.preventDefault()} className="card-link flex items-center gap-3">
        <LifebuoyIcon className="h-6 w-6 shrink-0 text-gov-navy" strokeWidth={1.6} />
        <span>
          <span className="block text-sm font-semibold text-slate-900">{t('dashboard.needHelp')}</span>
          <span className="block text-xs text-slate-500">{t('dashboard.needHelpDesc')}</span>
        </span>
      </a>
      <div className="card flex items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${systemOnline ? 'bg-emerald-500' : systemOnline === false ? 'bg-gov-red' : 'bg-slate-300'}`} aria-hidden="true" />
        <span>
          <span className="block text-sm font-semibold text-slate-900">{t('common.systemStatus')}</span>
          <span className="block text-xs text-slate-500">{systemOnline === null ? t('common.checking') : systemOnline ? t('common.allSystemsOperational') : t('common.systemUnreachable')}</span>
        </span>
      </div>
    </section>
  );
}

function StatTile({ icon: Icon, label, value, loading }) {
  return (
    <div className="card flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy"><Icon className="h-5 w-5" strokeWidth={1.75} /></span>
      <span>
        <span className="block text-xl font-bold leading-none text-slate-900">{loading ? '—' : value}</span>
        <span className="block text-xs text-slate-500">{label}</span>
      </span>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showFullPin, setShowFullPin] = useState(false);
  const [systemOnline, setSystemOnline] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [queueCount, setQueueCount] = useState(null);
  const [queueLoading, setQueueLoading] = useState(true);

  const isCitizen = user.roleKey === 'citizen';
  const isBranchAdmin = user.roleKey === 'branch_admin';
  const isSystemAdmin = user.roleKey === 'system_administrator';
  const isEmployee = !isCitizen;
  const isOfficer = isEmployee && !isBranchAdmin && !isSystemAdmin;
  const visibleDepartments = isCitizen ? DEPARTMENTS : [];

  useEffect(() => {
    if (isCitizen) api.get('/citizen/profile').then(setProfile).catch(() => {}).finally(() => setLoading(false));
    else setLoading(false);
  }, [isCitizen]);
  useEffect(() => { api.get('/health').then(() => setSystemOnline(true)).catch(() => setSystemOnline(false)); }, []);
  useEffect(() => {
    if (!isSystemAdmin) { setStatsLoading(false); return; }
    api.get('/admin/stats').then(setStats).catch(() => {}).finally(() => setStatsLoading(false));
  }, [isSystemAdmin]);
  useEffect(() => {
    if (!isOfficer) { setQueueLoading(false); return; }
    api.get('/applications').then((d) => {
      const open = (d.applications || []).filter((a) => !['Completed', 'Collected', 'Rejected'].includes(a.status));
      setQueueCount(open.length);
    }).catch(() => {}).finally(() => setQueueLoading(false));
  }, [isOfficer]);

  return (
    <div>
      <section className="relative overflow-hidden rounded-2xl bg-hero-gradient text-white shadow-header">
        <HeroBackdrop className="pointer-events-none absolute inset-0 h-full w-full" />
        <FlagOnPole className="pointer-events-none absolute bottom-0 right-6 h-24 w-16 sm:right-10 sm:h-28 sm:w-20" />
        <div className="relative z-10 px-6 py-10 sm:px-10">
          <p className="eyebrow text-white/70">{t('dashboard.welcomeBack')}</p>
          <h1 className="mt-1 text-2xl font-bold drop-shadow-sm sm:text-3xl">{user.email.split('@')[0]}</h1>

          {isCitizen && (
            <div className="mt-4 inline-flex max-w-full flex-wrap items-center gap-4 rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm">
              {loading ? <Loading /> : profile?.provisional ? (
                <div>
                  <p className="flex items-center gap-1.5 font-semibold text-amber-300">⚠ {t('auth.provisionalNoticeShort')}</p>
                  <p className="mt-1 text-sm text-white/80">{profile.message}</p>
                  <Link to="/home-affairs/identity-verification" className="mt-2 inline-block text-sm font-semibold text-white underline underline-offset-2 hover:text-white/90">
                    {t('homeAffairs.identityVerification')} →
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
                    <CheckCircleIcon className="h-5 w-5" strokeWidth={1.75} />{t('auth.verifiedNoticeShort')}
                  </p>
                  <button type="button" className="mt-1 font-mono text-base tracking-wide text-white underline-offset-2 hover:underline" onClick={() => setShowFullPin((s) => !s)}>
                    {showFullPin ? profile?.citizen?.permanent_identity_number : maskPin(profile?.citizen?.permanent_identity_number)}
                  </button>
                </div>
              )}
              <Link to="/profile" className="btn-secondary !border-white/30 !bg-white/10 !text-white hover:!bg-white/20">{t('nav.profile')}</Link>
            </div>
          )}

          {isEmployee && (
            <p className="mt-2 max-w-xl text-sm text-white/80">
              {t(`role.${user.roleKey}`)}
              {user.departmentKey && ` · ${t(`departments.${user.departmentKey}`)}`}
              {user.officeName && ` · ${user.officeName}`}
            </p>
          )}
        </div>
      </section>

      <QuickActionsStrip t={t} systemOnline={systemOnline} />

      {isSystemAdmin && (
        <section className="mt-10">
          <h2 className="section-title">{t('dashboard.systemAdministration')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('dashboard.systemAdministrationDesc')}</p>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile icon={UsersIcon} label={t('dashboard.statCitizens')} value={stats?.totalCitizens} loading={statsLoading} />
            <StatTile icon={UserPlusIcon} label={t('dashboard.statEmployees')} value={stats?.totalEmployees} loading={statsLoading} />
            <StatTile icon={BuildingOffice2Icon} label={t('dashboard.statOffices')} value={stats?.totalOffices} loading={statsLoading} />
            <StatTile icon={InboxStackIcon} label={t('dashboard.statPending')} value={stats?.pendingApplications} loading={statsLoading} />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link to="/admin/users" className="card-link flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm"><UsersIcon className="h-6 w-6" strokeWidth={1.75} /></span>
              <span>
                <span className="block text-base font-semibold text-slate-900">{t('admin.users')}</span>
                <span className="mt-1 block text-sm text-slate-600">{t('dashboard.manageUsersDesc')}</span>
              </span>
            </Link>
            <Link to="/admin/offices" className="card-link flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm"><BuildingOffice2Icon className="h-6 w-6" strokeWidth={1.75} /></span>
              <span>
                <span className="block text-base font-semibold text-slate-900">{t('admin.manageOffices')}</span>
                <span className="mt-1 block text-sm text-slate-600">{t('dashboard.manageOfficesCardDesc')}</span>
              </span>
            </Link>
            <Link to="/admin/settings" className="card-link flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-600 text-white shadow-sm"><Cog6ToothIcon className="h-6 w-6" strokeWidth={1.75} /></span>
              <span>
                <span className="block text-base font-semibold text-slate-900">{t('admin.systemSettings')}</span>
                <span className="mt-1 block text-sm text-slate-600">{t('dashboard.systemSettingsDesc')}</span>
              </span>
            </Link>
            <Link to="/admin/audit" className="card-link flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-600 text-white shadow-sm"><ClipboardDocumentListIcon className="h-6 w-6" strokeWidth={1.75} /></span>
              <span>
                <span className="block text-base font-semibold text-slate-900">{t('admin.auditLog')}</span>
                <span className="mt-1 block text-sm text-slate-600">{t('dashboard.auditLogDesc')}</span>
              </span>
            </Link>
          </div>
        </section>
      )}

      {isBranchAdmin && (
        <section className="mt-10">
          <h2 className="section-title">{t('dashboard.branchManagement')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('dashboard.branchManagementDesc', { office: user.officeName || '' })}</p>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Link to="/branch/users" className="card-link flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm"><UserPlusIcon className="h-6 w-6" strokeWidth={1.75} /></span>
              <span>
                <span className="block text-base font-semibold text-slate-900">{t('nav.manageEmployees')}</span>
                <span className="mt-1 block text-sm text-slate-600">{t('dashboard.manageEmployeesDesc')}</span>
              </span>
            </Link>
            <div className="card flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-600 text-white shadow-sm"><BuildingOffice2Icon className="h-6 w-6" strokeWidth={1.75} /></span>
              <span>
                <span className="block text-base font-semibold text-slate-900">{user.officeName}</span>
                <span className="mt-1 block text-sm text-slate-600">{t(`departments.${user.departmentKey}`)}</span>
              </span>
            </div>
          </div>
        </section>
      )}

      {isOfficer && (
        <section className="mt-10">
          <h2 className="section-title">{t('dashboard.myWorkspace')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('dashboard.myWorkspaceDesc', { department: t(`departments.${user.departmentKey}`) })}</p>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="card flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy"><InboxStackIcon className="h-6 w-6" strokeWidth={1.75} /></span>
              <span>
                <span className="block text-2xl font-bold leading-none text-slate-900">{queueLoading ? '—' : queueCount}</span>
                <span className="mt-1 block text-sm text-slate-600">{t('dashboard.openApplicationsDesc')}</span>
              </span>
            </div>
            <Link to={DEPARTMENT_ROUTES[user.departmentKey]} className="card-link flex items-center justify-between gap-4">
              <span className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm"><RectangleGroupIcon className="h-6 w-6" strokeWidth={1.75} /></span>
                <span>
                  <span className="block text-base font-semibold text-slate-900">{t('dashboard.goToWorkspace', { department: t(`departments.${user.departmentKey}`) })}</span>
                  <span className="mt-1 block text-sm text-slate-600">{user.officeName || ''}</span>
                </span>
              </span>
              <ChevronRightIcon className="h-5 w-5 shrink-0 text-slate-400" />
            </Link>
          </div>
        </section>
      )}

      {isCitizen && (
        <section className="mt-10">
          <h2 className="section-title">{t('dashboard.governmentDepartments')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('dashboard.chooseDepartmentDesc')}</p>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleDepartments.map((d) => <DepartmentCard key={d} departmentKey={d} />)}
          </div>
        </section>
      )}
    </div>
  );
}
