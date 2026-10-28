import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircleIcon, DocumentTextIcon, BellIcon, LifebuoyIcon, UserPlusIcon, BuildingOffice2Icon,
  UsersIcon, Cog6ToothIcon, ClipboardDocumentListIcon, RectangleGroupIcon, InboxStackIcon, ChevronRightIcon,
  ExclamationTriangleIcon, ShieldCheckIcon, BanknotesIcon, BuildingLibraryIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import DepartmentCard from '../components/DepartmentCard';
import Loading from '../components/ui/Loading';
import { HeroBackdrop } from '../components/ui/HeroBackdrop';

const DEPARTMENTS = ['home_affairs', 'traffic', 'finance', 'pensions', 'police', 'passport'];
const DEPARTMENT_ROUTES = { home_affairs: '/home-affairs', traffic: '/traffic', finance: '/finance', pensions: '/pensions', police: '/police', passport: '/passport' };

function maskPin(pin) {
  if (!pin) return '';
  return pin.slice(0, -4).replace(/./g, '•') + pin.slice(-4);
}

// DESIGN PREVIEW (this file only) — a single reusable "masthead" standing in for the plain
// h2/p pairing every section used before. An icon badge + title + one-line description, with a
// hairline rule underneath, so every section on the page reads as one consistent, deliberately
// designed system rather than a stack of ad-hoc cards. If this direction is approved, the same
// pattern should move into index.css (e.g. a `.section-header` layer class) so other pages can
// share it instead of each page re-implementing it — left as plain Tailwind here, scoped to this
// file only, specifically so this preview touches nothing else.
function SectionHeader({ icon: Icon, tint = 'navy', title, description }) {
  const TINTS = {
    navy: 'bg-gov-navy/10 text-gov-navy',
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
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

function QuickActionsStrip({ t, systemOnline, isCitizen }) {
  return (
    <section className="mt-10">
      <SectionHeader icon={RectangleGroupIcon} tint="slate" title={t('dashboard.quickActions')} />
      <div className={`mt-5 grid grid-cols-2 gap-3 ${isCitizen ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
        <Link to="/applications" className="card-link flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy" aria-hidden="true">
            <DocumentTextIcon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">{t('dashboard.trackApplication')}</span>
            <span className="block text-xs text-slate-500">{t('dashboard.trackApplicationDesc')}</span>
          </span>
        </Link>
        <Link to="/notifications" className="card-link flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy" aria-hidden="true">
            <BellIcon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">{t('nav.notifications')}</span>
            <span className="block text-xs text-slate-500">{t('dashboard.viewNotificationsDesc')}</span>
          </span>
        </Link>
        {isCitizen && (
          // Migration 078 — the ONE shared entry point for reporting a financial issue against
          // any department, instead of a tile on every department's own hub.
          <Link to="/report-financial-issue" className="card-link flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy" aria-hidden="true">
              <InboxStackIcon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-900">{t('finance.reportIssue.title')}</span>
              <span className="block text-xs text-slate-500">{t('finance.reportIssue.quickActionDesc')}</span>
            </span>
          </Link>
        )}
        <a href="#" onClick={(e) => e.preventDefault()} className="card-link flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gov-navy/10 text-gov-navy" aria-hidden="true">
            <LifebuoyIcon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">{t('dashboard.needHelp')}</span>
            <span className="block text-xs text-slate-500">{t('dashboard.needHelpDesc')}</span>
          </span>
        </a>
        <div className="card flex items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${systemOnline ? 'bg-emerald-50' : systemOnline === false ? 'bg-red-50' : 'bg-slate-100'}`} aria-hidden="true">
            <span className={`h-2.5 w-2.5 rounded-full ${systemOnline ? 'bg-emerald-500' : systemOnline === false ? 'bg-gov-red' : 'bg-slate-300'}`} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-slate-900">{t('common.systemStatus')}</span>
            <span className="block text-xs text-slate-500">{systemOnline === null ? t('common.checking') : systemOnline ? t('common.allSystemsOperational') : t('common.systemUnreachable')}</span>
          </span>
        </div>
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
  // Migration 078 — switches between departments rather than belonging to one, so it must be
  // excluded from isOfficer below (which assumes a single, fixed user.departmentKey).
  const isDeptFinanceAdmin = user.roleKey === 'department_finance_admin';
  const isEmployee = !isCitizen;
  const isOfficer = isEmployee && !isBranchAdmin && !isSystemAdmin && !isDeptFinanceAdmin;
  // user.isForeignNational (migration 051) is a PERMANENT historical flag — it stays TRUE even
  // after a foreign national is naturalised and granted a citizen_id, as a record of how they
  // became a citizen. It must never be used alone to decide current access (that was a bug: it
  // kept hiding every department from a citizen who had already been fully naturalised). The
  // only thing that should ever gate access is whether citizen_id is still missing — exactly
  // like a provisional account. Once naturalization is approved and citizen_id is set, this
  // account is a full citizen in every respect.
  const isLockedOutForeignNational = isCitizen && !!user.isForeignNational && !user.citizenId;
  const visibleDepartments = isCitizen && !isLockedOutForeignNational ? DEPARTMENTS : [];

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
        {/* Thin gold rule along the top edge — a small, deliberate "seal of state" accent rather
            than a flat gradient panel with nothing marking it as official. */}
        <div className="absolute inset-x-0 top-0 z-10 h-1 bg-gov-gold" aria-hidden="true" />

        <div className="relative z-10 px-6 py-10 sm:px-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="eyebrow text-white/70">{t('dashboard.welcomeBack')}</p>
              <h1 className="mt-1 text-2xl font-bold drop-shadow-sm sm:text-3xl">{user.username}</h1>

              {isEmployee && (
                <p className="mt-2 max-w-xl text-sm text-white/80">
                  {t(`role.${user.roleKey}`)}
                  {isDeptFinanceAdmin
                    ? (user.activeDepartmentKey ? ` · ${t(`departments.${user.activeDepartmentKey}`)} · ${user.activeOfficeName}` : ` · ${t('deptFinance.noContextShort')}`)
                    : <>
                      {user.departmentKey && ` · ${t(`departments.${user.departmentKey}`)}`}
                      {user.officeName && ` · ${user.officeName}`}
                    </>}
                </p>
              )}

              {isCitizen && profile?.pendingParentConfirmations?.length > 0 && (
                <div className="mt-4 inline-flex max-w-full flex-wrap items-center gap-4 rounded-xl bg-amber-400/20 px-4 py-3 backdrop-blur-sm">
                  <div>
                    <p className="flex items-center gap-1.5 font-semibold text-amber-300">
                      <ExclamationTriangleIcon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                      {t('dashboard.pendingParentConfirmationNotice', { count: profile.pendingParentConfirmations.length })}
                    </p>
                  </div>
                  <Link to="/home-affairs/parent-confirmations" className="btn-secondary !border-white/30 !bg-white/10 !text-white hover:!bg-white/20">
                    {t('common.viewDetails')}
                  </Link>
                </div>
              )}
            </div>

            {/* Identity / credential panel — the citizen-facing status block, now its own bordered
                card (reads like a government ID summary) instead of floating directly on the
                gradient. */}
            {isCitizen && (
              <div className="w-full max-w-sm shrink-0 rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm lg:w-80">
                <p className="eyebrow text-white/60">{t('dashboard.identityStatus')}</p>
                {loading ? (
                  <div className="mt-2"><Loading /></div>
                ) : profile?.foreignNational ? (
                  <div className="mt-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
                      <ExclamationTriangleIcon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                      {t('auth.foreignNationalNoticeShort')}
                    </p>
                    <p className="mt-1 text-sm text-white/80">{profile.message}</p>
                    <div className="mt-3 flex flex-col gap-1.5">
                      <Link to="/home-affairs/naturalization" className="inline-flex items-center gap-1 text-sm font-semibold text-white underline underline-offset-2 hover:text-white/90">
                        {t('homeAffairs.naturalization')} <ChevronRightIcon className="h-3.5 w-3.5" />
                      </Link>
                      <Link to="/home-affairs/marriage-citizenship" className="inline-flex items-center gap-1 text-sm font-semibold text-white underline underline-offset-2 hover:text-white/90">
                        {t('homeAffairs.marriageCitizenship')} <ChevronRightIcon className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                ) : profile?.provisional ? (
                  <div className="mt-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
                      <ExclamationTriangleIcon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                      {t('auth.provisionalNoticeShort')}
                    </p>
                    <p className="mt-1 text-sm text-white/80">{profile.message}</p>
                    <Link to="/apply-for-birth-certificate" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-white underline underline-offset-2 hover:text-white/90">
                      {t('homeAffairs.applyForBirthCertificate')} <ChevronRightIcon className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                ) : (
                  <div className="mt-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
                      <CheckCircleIcon className="h-5 w-5 shrink-0" strokeWidth={1.75} />{t('auth.verifiedNoticeShort')}
                    </p>
                    <button
                      type="button"
                      className="mt-2 inline-block rounded-md border border-white/20 bg-black/10 px-3 py-1.5 font-mono text-sm tracking-wide text-white hover:bg-black/20"
                      onClick={() => setShowFullPin((s) => !s)}
                    >
                      {showFullPin ? profile?.citizen?.permanent_identity_number : maskPin(profile?.citizen?.permanent_identity_number)}
                    </button>
                  </div>
                )}
                <Link to="/profile" className="btn-secondary mt-3 w-full !border-white/30 !bg-white/10 !text-white hover:!bg-white/20">{t('nav.profile')}</Link>
              </div>
            )}
          </div>
        </div>
      </section>

      <QuickActionsStrip t={t} systemOnline={systemOnline} isCitizen={isCitizen} />

      {isSystemAdmin && (
        <section className="mt-10">
          <SectionHeader icon={ShieldCheckIcon} title={t('dashboard.systemAdministration')} description={t('dashboard.systemAdministrationDesc')} />

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
          <SectionHeader icon={BuildingOffice2Icon} tint="blue" title={t('dashboard.branchManagement')} description={t('dashboard.branchManagementDesc', { office: user.officeName || '' })} />
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Link to="/branch/users" className="card-link flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm"><UserPlusIcon className="h-6 w-6" strokeWidth={1.75} /></span>
              <span>
                <span className="block text-base font-semibold text-slate-900">{t('nav.manageEmployees')}</span>
                <span className="mt-1 block text-sm text-slate-600">{t('dashboard.manageEmployeesDesc')}</span>
              </span>
            </Link>
            <Link to="/branch/budget-requests" className="card-link flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-600 text-white shadow-sm"><InboxStackIcon className="h-6 w-6" strokeWidth={1.75} /></span>
              <span>
                <span className="block text-base font-semibold text-slate-900">{t('finance.budgetRequests.branchTitle')}</span>
                <span className="mt-1 block text-sm text-slate-600">{t('dashboard.branchBudgetRequestsDesc')}</span>
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

      {isDeptFinanceAdmin && (
        <section className="mt-10">
          <SectionHeader icon={BanknotesIcon} tint="amber" title={t('deptFinance.title')} description={t('deptFinance.intro')} />
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Link to="/department-finance" className="card-link flex items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-600 text-white shadow-sm"><BuildingOffice2Icon className="h-6 w-6" strokeWidth={1.75} /></span>
              <span>
                <span className="block text-base font-semibold text-slate-900">
                  {user.activeOfficeId ? `${t(`departments.${user.activeDepartmentKey}`)} — ${user.activeOfficeName}` : t('deptFinance.noContextShort')}
                </span>
                <span className="mt-1 block text-sm text-slate-600">{t('deptFinance.switchContext')}</span>
              </span>
            </Link>
            {user.activeOfficeId && (
              <>
                <Link to="/department-finance/issues" className="card-link flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm"><InboxStackIcon className="h-6 w-6" strokeWidth={1.75} /></span>
                  <span>
                    <span className="block text-base font-semibold text-slate-900">{t('deptFinance.issuesTitle')}</span>
                    <span className="mt-1 block text-sm text-slate-600">{t('deptFinance.issuesDesc')}</span>
                  </span>
                </Link>
                <Link to="/department-finance/employees" className="card-link flex items-start gap-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm"><UserPlusIcon className="h-6 w-6" strokeWidth={1.75} /></span>
                  <span>
                    <span className="block text-base font-semibold text-slate-900">{t('nav.manageEmployees')}</span>
                    <span className="mt-1 block text-sm text-slate-600">{t('deptFinance.employeesDesc')}</span>
                  </span>
                </Link>
              </>
            )}
          </div>
        </section>
      )}

      {isOfficer && (
        <section className="mt-10">
          <SectionHeader icon={RectangleGroupIcon} tint="blue" title={t('dashboard.myWorkspace')} description={t('dashboard.myWorkspaceDesc', { department: t(`departments.${user.departmentKey}`) })} />
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

      {isCitizen && !isLockedOutForeignNational && (
        <section className="mt-10">
          <SectionHeader icon={BuildingLibraryIcon} title={t('dashboard.governmentDepartments')} description={t('dashboard.chooseDepartmentDesc')} />
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleDepartments.map((d) => <DepartmentCard key={d} departmentKey={d} />)}
          </div>
        </section>
      )}
    </div>
  );
}
