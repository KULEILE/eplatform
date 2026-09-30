import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

const SERVICES = [
  { key: 'clearance', to: '/police/clearance', icon: '📄', roles: ['citizen', 'police_officer', 'system_administrator'] },
  { key: 'identityLookup', to: '/police/identity-verification', icon: '🔎', roles: ['police_officer', 'system_administrator'] },
];

/** Police previously had no citizen-facing entry point at all — only the officer-only identity
 *  verification lookup tool, which a citizen's role was blocked from ever seeing. This hub
 *  gives citizens somewhere to actually request a Police Clearance Certificate. */
export default function PoliceHub() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const visible = SERVICES.filter((s) => s.roles.includes(user.roleKey));

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('departments.police')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('police.services')}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visible.map((s) => (
          <Link key={s.key} to={s.to} className="card flex items-center gap-3 hover:-translate-y-0.5 hover:shadow-md transition">
            <span className="text-2xl" aria-hidden="true">{s.icon}</span>
            <span className="font-semibold text-slate-900">{t(`police.${s.key === 'clearance' ? 'clearance.title' : 'identityLookup'}`)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
