import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

const SERVICES = [
  { key: 'identityVerification', to: '/home-affairs/identity-verification', icon: '🔎', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'birthRegistration', to: '/home-affairs/birth-registration', icon: '👶', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'nationalIdApplication', to: '/home-affairs/national-id', icon: '🪪', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'marriageRegistration', to: '/home-affairs/marriage-registration', icon: '💍', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'divorceRegistration', to: '/home-affairs/divorce-registration', icon: '📑', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'deathRegistration', to: '/home-affairs/death-registration', icon: '🕊️', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'correction', to: '/home-affairs/corrections', icon: '✏️', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'nationalIdRenewReplace', to: '/home-affairs/national-id/renew-replace', icon: '🔄', roles: ['citizen'] },
  { key: 'birthCertificateReissue', to: '/home-affairs/birth-certificate-reissue', icon: '📜', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'deathCertificateRequest', to: '/home-affairs/death-certificate-request', icon: '🕯️', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'nameChange', to: '/home-affairs/name-change', icon: '🖋️', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'adoption', to: '/home-affairs/adoption', icon: '👨‍👩‍👧', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'burialOrder', to: '/home-affairs/burial-order', icon: '⚱️', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'specialLicence', to: '/home-affairs/special-marriage-licence', icon: '💌', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'solemnisation', to: '/home-affairs/marriage-solemnisation', icon: '⛪', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'marriageOfficers', to: '/home-affairs/marriage-officers', icon: '📋', roles: ['home_affairs_officer', 'system_administrator'] },
  { key: 'naturalization', to: '/home-affairs/naturalization', icon: '🌍', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
  { key: 'applicationTracking', to: '/applications', icon: '📊', roles: ['citizen', 'home_affairs_officer', 'system_administrator'] },
];

export default function HomeAffairsHub() {
  const { t } = useLanguage();
  const { user } = useAuth();
  // A foreign-national account (migration 051) has no citizen_id and no access to any other
  // Home Affairs service — every one of them requires a verified citizen record — so it sees
  // ONLY Citizenship by Naturalization and its own application tracking. Conversely, a citizen
  // who is NOT a foreign national never needs the naturalization service, so it's hidden from
  // them (it still shows for officers/admins, who review the applications).
  const isForeignNational = user.roleKey === 'citizen' && !!user.isForeignNational;
  const visible = SERVICES.filter((s) => {
    if (!s.roles.includes(user.roleKey)) return false;
    if (user.roleKey !== 'citizen') return true;
    if (isForeignNational) return s.key === 'naturalization' || s.key === 'applicationTracking';
    return s.key !== 'naturalization';
  });
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);
  const [pendingIdentityCount, setPendingIdentityCount] = useState(null);

  useEffect(() => {
    if (!isOfficer) return;
    api.get('/identity/requests?status=Pending').then((d) => setPendingIdentityCount((d.requests || []).length)).catch(() => {});
  }, [isOfficer]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('departments.home_affairs')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('homeAffairs.services')}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => (
          <Link key={s.key} to={s.to} className="card flex items-center gap-3 hover:-translate-y-0.5 hover:shadow-md transition">
            <span className="text-2xl" aria-hidden="true">{s.icon}</span>
            <span className="font-semibold text-slate-900">{t(`homeAffairs.${s.key}`)}</span>
            {s.key === 'identityVerification' && isOfficer && !!pendingIdentityCount && (
              <span className="ml-auto flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-gov-red px-1.5 text-[11px] font-bold text-white">{pendingIdentityCount}</span>
            )}
          </Link>
        ))}
        {!isForeignNational && (
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
