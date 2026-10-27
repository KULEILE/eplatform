import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { InboxStackIcon, UserPlusIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';

/**
 * Entry point for the Department Finance Administrator role (migration 078 — "to avoid many
 * change let's make this sub public services should have administrator that will switch choose
 * which department office they want to login and solve per department it and add employees of
 * that we must have all categories"). Every department is selectable here, not a restricted
 * assigned subset ("all categories"). Once a department+office is chosen, this administrator
 * resolves or escalates financial issues raised there, and manages that office's employee
 * accounts — both scoped to req.user.activeDepartmentKey/activeOfficeId on the backend.
 */
export default function DeptFinanceHub() {
  const { user, refresh } = useAuth();
  const { t } = useLanguage();
  const [departments, setDepartments] = useState([]);
  const [offices, setOffices] = useState([]);
  const [departmentKey, setDepartmentKey] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.get('/departments').then((d) => setDepartments(d.departments)); }, []);
  useEffect(() => {
    setOffices([]);
    setOfficeId('');
    if (!departmentKey) return;
    api.get(`/offices?departmentKey=${departmentKey}`).then((d) => setOffices(d.offices));
  }, [departmentKey]);

  async function switchContext(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/department-finance/context', { departmentKey, officeId });
      await refresh();
      setDepartmentKey('');
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  const hasContext = !!user.activeOfficeId;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('deptFinance.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('deptFinance.intro')}</p>

      {hasContext && (
        <div className="card mb-6 border-2 border-emerald-200 bg-emerald-50">
          <p className="text-sm font-semibold text-emerald-800">{t('deptFinance.currentContext')}</p>
          <p className="mt-1 text-base font-bold text-slate-900">
            {t(`departments.${user.activeDepartmentKey}`)} — {user.activeOfficeName}
          </p>
        </div>
      )}

      <form onSubmit={switchContext} className="card mb-8">
        <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
          <ArrowPathIcon className="h-5 w-5" strokeWidth={1.75} />
          {hasContext ? t('deptFinance.switchContext') : t('deptFinance.chooseContext')}
        </h2>
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('admin.department')} htmlFor="departmentKey" required>
            <select id="departmentKey" className="form-input" value={departmentKey} onChange={(e) => setDepartmentKey(e.target.value)}>
              <option value="">{t('admin.selectDepartment')}</option>
              {departments.map((d) => <option key={d.department_key} value={d.department_key}>{d.name}</option>)}
            </select>
          </FormField>
          <FormField label={t('offices.branch')} htmlFor="officeId" required>
            <select id="officeId" className="form-input" value={officeId} onChange={(e) => setOfficeId(e.target.value)} disabled={!departmentKey || offices.length === 0}>
              <option value="">{!departmentKey ? t('offices.selectDistrictFirst') : t('offices.selectBranch')}</option>
              {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.name}{o.district_name ? ` — ${o.district_name}` : ''}</option>)}
            </select>
          </FormField>
        </div>
        <button type="submit" disabled={busy || !departmentKey || !officeId} className="btn-primary">
          {busy ? t('common.loading') : t('deptFinance.switchButton')}
        </button>
      </form>

      {hasContext && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>
      )}
    </div>
  );
}
