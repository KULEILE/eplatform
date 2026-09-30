import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';

export default function AdminDashboard() {
  const { t } = useLanguage();
  const tiles = [
    { to: '/admin/settings', icon: '⚙️', label: t('admin.systemSettings') },
    { to: '/admin/users', icon: '👥', label: t('admin.users') },
    { to: '/admin/offices', icon: '🏢', label: t('admin.manageOffices') },
    { to: '/admin/audit', icon: '🧾', label: t('admin.auditLog') },
  ];
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('admin.title')}</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link key={tile.to} to={tile.to} className="card flex items-center gap-3 hover:-translate-y-0.5 hover:shadow-md transition">
            <span className="text-2xl" aria-hidden="true">{tile.icon}</span>
            <span className="font-semibold text-slate-900">{tile.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
