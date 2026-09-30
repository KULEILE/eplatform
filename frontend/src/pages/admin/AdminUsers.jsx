import React, { useEffect, useState } from 'react';
import { ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import FormField from '../../components/ui/FormField';

const OFFICER_ROLE_OPTIONS = ['home_affairs_officer', 'traffic_officer', 'finance_officer', 'pensions_officer', 'police_officer', 'passport_officer'];
const DEPT_FOR_ROLE = {
  home_affairs_officer: 'home_affairs', traffic_officer: 'traffic', finance_officer: 'finance',
  pensions_officer: 'pensions', police_officer: 'police', passport_officer: 'passport',
};

/**
 * Employee account management. Same page, two scopes:
 *  - System Administrator (mounted at /admin/users): appoints Branch Administrators to any
 *    branch, or creates any officer/administrator account directly.
 *  - Branch Administrator (mounted at /branch/users): can only create officer accounts for
 *    their OWN department and OWN branch — the backend enforces this regardless of what this
 *    UI sends, but the UI reflects it so the form doesn't ask for choices they don't have.
 */
export default function AdminUsers() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isBranchAdmin = user.roleKey === 'branch_admin';

  const [users, setUsers] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [offices, setOffices] = useState([]);
  const [form, setForm] = useState({ email: '', phone: '', roleKey: isBranchAdmin ? DEPT_FOR_ROLE_KEY(user.departmentKey) : 'branch_admin', departmentKey: '', officeId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null); // { email, temporaryPassword }
  const [copied, setCopied] = useState(false);

  function DEPT_FOR_ROLE_KEY(deptKey) {
    return OFFICER_ROLE_OPTIONS.find((r) => DEPT_FOR_ROLE[r] === deptKey) || OFFICER_ROLE_OPTIONS[0];
  }

  function load() { api.get('/admin/users').then((d) => setUsers(d.users)); }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!isBranchAdmin) api.get('/departments').then((d) => setDepartments(d.departments)); }, [isBranchAdmin]);

  const needsDepartmentPicker = !isBranchAdmin && form.roleKey === 'branch_admin';
  const needsOfficePicker = !isBranchAdmin && (form.roleKey === 'branch_admin' || OFFICER_ROLE_OPTIONS.includes(form.roleKey));
  const officeDepartmentKey = form.roleKey === 'branch_admin' ? form.departmentKey : DEPT_FOR_ROLE[form.roleKey];

  useEffect(() => {
    setOffices([]);
    setForm((f) => ({ ...f, officeId: '' }));
    if (!needsOfficePicker || !officeDepartmentKey) return;
    api.get(`/offices?departmentKey=${officeDepartmentKey}`).then((d) => setOffices(d.offices));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeDepartmentKey, needsOfficePicker]);

  async function createUser(e) {
    e.preventDefault();
    setError('');
    setCreated(null);
    setBusy(true);
    try {
      const payload = { email: form.email, phone: form.phone || undefined, roleKey: form.roleKey };
      if (!isBranchAdmin) {
        payload.departmentKey = form.roleKey === 'branch_admin' ? form.departmentKey : DEPT_FOR_ROLE[form.roleKey];
        payload.officeId = form.officeId || undefined;
      }
      const result = await api.post('/admin/users', payload);
      setCreated({ email: result.user.email, temporaryPassword: result.temporaryPassword });
      setCopied(false);
      setForm((f) => ({ ...f, email: '', phone: '', officeId: '' }));
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(u) {
    const next = u.account_status === 'Active' ? 'Suspended' : 'Active';
    await api.patch(`/admin/users/${u.user_id}`, { accountStatus: next });
    load();
  }

  function copyTemp() {
    if (!created) return;
    navigator.clipboard?.writeText(created.temporaryPassword).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{isBranchAdmin ? t('nav.manageEmployees') : t('admin.users')}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {isBranchAdmin
          ? t('admin.branchAdminUsersDesc', { office: user.officeName || '', department: t(`departments.${user.departmentKey}`) })
          : t('admin.systemAdminUsersDesc')}
      </p>

      <form onSubmit={createUser} className="card mb-8">
        <h2 className="mb-4 font-semibold text-slate-800">{isBranchAdmin ? t('admin.createOfficer') : t('admin.createUser')}</h2>
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('auth.email')} htmlFor="email" required>
            <input id="email" type="email" required className="form-input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </FormField>
          <FormField label={t('auth.phone')} htmlFor="phone">
            <input id="phone" className="form-input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </FormField>

          {isBranchAdmin ? (
            <FormField label={t('admin.role')} htmlFor="role">
              <input disabled className="form-input bg-slate-100 text-slate-500" value={t(`role.${DEPT_FOR_ROLE_KEY(user.departmentKey)}`)} />
            </FormField>
          ) : (
            <FormField label={t('admin.role')} htmlFor="role" required>
              <select id="role" className="form-input" value={form.roleKey} onChange={(e) => setForm((f) => ({ ...f, roleKey: e.target.value, departmentKey: '' }))}>
                <option value="branch_admin">{t('role.branch_admin')}</option>
                {OFFICER_ROLE_OPTIONS.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                <option value="system_administrator">{t('role.system_administrator')}</option>
              </select>
            </FormField>
          )}

          {needsDepartmentPicker && (
            <FormField label={t('admin.department')} htmlFor="departmentKey" required>
              <select id="departmentKey" className="form-input" value={form.departmentKey} onChange={(e) => setForm((f) => ({ ...f, departmentKey: e.target.value }))}>
                <option value="">{t('admin.selectDepartment')}</option>
                {departments.map((d) => <option key={d.department_key} value={d.department_key}>{d.name}</option>)}
              </select>
            </FormField>
          )}

          {needsOfficePicker && (
            <FormField label={t('offices.branch')} htmlFor="officeId" required>
              <select id="officeId" className="form-input" value={form.officeId} onChange={(e) => setForm((f) => ({ ...f, officeId: e.target.value }))} disabled={!officeDepartmentKey || offices.length === 0}>
                <option value="">{!officeDepartmentKey ? t('offices.selectDistrictFirst') : t('offices.selectBranch')}</option>
                {offices.map((o) => <option key={o.office_id} value={o.office_id}>{o.name}{o.district_name ? ` — ${o.district_name}` : ''}</option>)}
              </select>
            </FormField>
          )}
        </div>

        <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">ℹ {t('admin.tempPasswordNotice')}</p>
        <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : (isBranchAdmin ? t('admin.createOfficer') : t('admin.createUser'))}</button>
      </form>

      {created && (
        <div className="card mb-8 border-2 border-emerald-200 bg-emerald-50">
          <p className="mb-2 text-sm font-semibold text-emerald-800">{t('admin.accountCreatedTitle', { email: created.email })}</p>
          <p className="mb-3 text-xs text-emerald-700">{t('admin.accountCreatedHelp')}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-white px-3 py-2 font-mono text-sm text-slate-800 ring-1 ring-emerald-200">{created.temporaryPassword}</code>
            <button type="button" onClick={copyTemp} className="btn-secondary !py-2">
              {copied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
        </div>
      )}

      {users && (
        <DataTable
          rowKey="user_id"
          rows={users}
          columns={[
            { key: 'email', header: t('auth.email') },
            { key: 'role_name', header: t('admin.role') },
            { key: 'department_name', header: t('admin.department'), render: (r) => r.department_name || '—' },
            { key: 'office_name', header: t('offices.branch'), render: (r) => r.office_name || '—' },
            { key: 'account_status', header: t('admin.accountStatus'), render: (r) => <StatusBadge status={r.account_status} /> },
            { key: 'must_change_password', header: t('admin.passwordStatus'), render: (r) => r.must_change_password ? <span className="text-xs font-medium text-gov-amber">⚠ {t('admin.temporaryPassword')}</span> : <span className="text-xs text-slate-400">—</span> },
            {
              key: 'actions', header: t('common.actions'),
              render: (r) => (
                <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => toggleStatus(r)}>
                  {r.account_status === 'Active' ? t('admin.suspend') : t('admin.reactivate')}
                </button>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
