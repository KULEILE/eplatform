import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import DepartmentCard from '../components/DepartmentCard';

const DEPARTMENTS = ['home_affairs', 'traffic', 'finance', 'pensions', 'police', 'passport'];

export default function Departments() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const isEmployee = user.roleKey !== 'citizen';
  const visible = isEmployee
    ? DEPARTMENTS.filter((d) => user.departmentKey === d || user.roleKey === 'system_administrator')
    : DEPARTMENTS;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('departments.chooseTitle')}</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((d) => <DepartmentCard key={d} departmentKey={d} />)}
      </div>
    </div>
  );
}
