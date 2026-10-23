import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

// The old self-service "Identity Verification" tile (manual, officer-reviewed) was removed —
// every account is now verified automatically, either the moment it's created (an existing
// citizen typing their permanent identity number) or via the public birth certificate
// application for someone with no record at all. See identity.controller.js and Register.jsx.
const SERVICES = [
  { key: 'birthRegistration', to: '/home-affairs/birth-registration', icon: '👶', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'nationalIdApplication', to: '/home-affairs/national-id', icon: '🪪', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'marriageRegistration', to: '/home-affairs/marriage-registration', icon: '💍', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'divorceRegistration', to: '/home-affairs/divorce-registration', icon: '📑', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'deathRegistration', to: '/home-affairs/death-registration', icon: '🕊️', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'correction', to: '/home-affairs/corrections', icon: '✏️', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'nationalIdRenewReplace', to: '/home-affairs/national-id/renew-replace', icon: '🔄', roles: ['citizen'] },
  // Birth certificate reissue no longer has its own tile — it's reached from inside the "Birth
  // Certificate" section below, where a citizen picks their own certificate or a specific
  // child's instead of going straight to a standalone reissue form.
  { key: 'birthCertificates', to: '/home-affairs/birth-certificates', icon: '📜', roles: ['citizen'] },
  { key: 'nameChange', to: '/home-affairs/name-change', icon: '🖋️', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'adoption', to: '/home-affairs/adoption', icon: '👨‍👩‍👧', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'solemnisation', to: '/home-affairs/marriage-solemnisation', icon: '⛪', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'marriageOfficers', to: '/home-affairs/marriage-officers', icon: '📋', roles: ['home_affairs_officer', 'system_administrator'] },
  // Officer-only: the ONE point anywhere in the birth-certificate domain an officer is involved —
  // resolving a parentage dispute. See migration 061.
  { key: 'parentageDisputes', to: '/home-affairs/parentage-disputes', icon: '⚖️', roles: ['home_affairs_officer', 'system_administrator'] },
  { key: 'naturalization', to: '/home-affairs/naturalization', icon: '🌍', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'applicationTracking', to: '/applications', icon: '📊', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
];

export default function HomeAffairsHub() {
  const { t } = useLanguage();
  const { user } = useAuth();
  // user.isForeignNational (migration 051) is a PERMANENT historical flag — it stays TRUE even
  // after naturalization is approved and citizen_id is set, as a record of how this citizen
  // became one. Gating on that flag alone was a bug: it kept locking a fully naturalised
  // citizen out of every Home Affairs service forever. What actually determines access is
  // whether citizen_id is still missing (isLockedOutForeignNational below) — once it's set,
  // this account behaves exactly like any other citizen's, including hiding the naturalization
  // service itself (no longer relevant to them) the same way it's hidden from a citizen who was
  // never a foreign national.
  const wasForeignNational = user.roleKey === 'citizen' && !!user.isForeignNational;
  const isLockedOutForeignNational = wasForeignNational && !user.citizenId;
  const visible = SERVICES.filter((s) => {
    if (!s.roles.includes(user.roleKey)) return false;
    if (user.roleKey !== 'citizen') return true;
    if (isLockedOutForeignNational) return s.key === 'naturalization' || s.key === 'applicationTracking';
    // A citizen who was never a foreign national has no reason to see this service. One who
    // WAS (even if long since naturalised) keeps seeing it, so they can still see their own
    // approved application and certificate number.
    if (s.key === 'naturalization') return wasForeignNational;
    return true;
  });
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('departments.home_affairs')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('homeAffairs.services')}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => (
          <Link key={s.key} to={s.to} className="card flex items-center gap-3 hover:-translate-y-0.5 hover:shadow-md transition">
            <span className="text-2xl" aria-hidden="true">{s.icon}</span>
            <span className="font-semibold text-slate-900">{t(`homeAffairs.${s.key}`)}</span>
          </Link>
        ))}
        {!isLockedOutForeignNational && (
          <Link to="/passport" className="card flex items-center gap-3 hover:-translate-y-0.5 hover:shadow-md transition">
            <span className="text-2xl" aria-hidden="true">🛂</span>
            <span className="font-semibold text-slate-900">{t('departments.passport')}</span>
            <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{t('departments.groupedUnderHomeAffairs')}</span>
          </Link>
        )}
      </div>
    </div>
  );
}
