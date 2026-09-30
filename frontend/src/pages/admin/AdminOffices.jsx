import React, { useEffect, useState } from 'react';
import { BuildingOffice2Icon, MapPinIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import FormField from '../../components/ui/FormField';

const DEPARTMENT_KEYS = ['home_affairs', 'traffic', 'finance', 'pensions', 'police', 'passport'];

const emptyForm = { departmentKey: '', districtId: '', name: '', officeCode: '', address: '', isHeadOffice: false };

/**
 * System Administrator only — opens new branch offices (any department, any district) and
 * edits existing ones. This is what was missing: the dashboard could show office counts but
 * had no screen to actually create a branch, so "0 Branch Offices" had no way forward.
 */
export default function AdminOffices() {
  const { t } = useLanguage();
  const [offices, setOffices] = useState(null);
  const [districts, setDistricts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  function load() { api.get('/offices/all').then((d) => setOffices(d.offices)).catch(() => setOffices([])); }
  useEffect(() => { load(); }, []);
  useEffect(() => { api.get('/districts').then((d) => setDistricts(d.districts)).catch(() => setDistricts([])); }, []);

  function startEdit(o) {
    setEditingId(o.office_id);
    setForm({
      departmentKey: o.department_key,
      districtId: o.district_id || '',
      name: o.name,
      officeCode: o.office_code || '',
      address: o.address || '',
      isHeadOffice: !!o.is_head_office,
    });
    setError('');
    setSuccess('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!form.name || !form.districtId || (!editingId && !form.departmentKey)) {
      setError(t('admin.officesFormRequired'));
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await api.patch(`/offices/${editingId}`, {
          name: form.name,
          districtId: form.districtId,
          officeCode: form.officeCode || null,
          address: form.address || null,
          isHeadOffice: form.isHeadOffice,
        });
        setSuccess(t('admin.officeUpdated', { name: form.name }));
      } else {
        await api.post('/offices', {
          departmentKey: form.departmentKey,
          districtId: form.districtId,
          name: form.name,
          officeCode: form.officeCode || undefined,
          address: form.address || undefined,
          isHeadOffice: form.isHeadOffice,
        });
        setSuccess(t('admin.officeCreated', { name: form.name }));
      }
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('admin.manageOffices')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('admin.manageOfficesDesc')}</p>

      <form onSubmit={submit} className="card mb-8">
        <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-800">
          <BuildingOffice2Icon className="h-5 w-5 text-gov-navy" strokeWidth={1.75} />
          {editingId ? t('admin.editOffice') : t('admin.createOffice')}
        </h2>
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        {success && <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">✓ {success}</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={t('admin.department')} htmlFor="departmentKey" required>
            <select
              id="departmentKey"
              className="form-input disabled:bg-slate-100 disabled:text-slate-500"
              value={form.departmentKey}
              onChange={(e) => setForm((f) => ({ ...f, departmentKey: e.target.value }))}
              disabled={!!editingId}
            >
              <option value="">{t('admin.selectDepartment')}</option>
              {DEPARTMENT_KEYS.map((k) => <option key={k} value={k}>{t(`departments.${k}`)}</option>)}
            </select>
          </FormField>

          <FormField label={t('offices.district')} htmlFor="districtId" required>
            <select id="districtId" className="form-input" value={form.districtId} onChange={(e) => setForm((f) => ({ ...f, districtId: e.target.value }))}>
              <option value="">{t('offices.selectDistrict')}</option>
              {districts.map((d) => <option key={d.district_id} value={d.district_id}>{d.name}</option>)}
            </select>
          </FormField>

          <FormField label={t('admin.officeName')} htmlFor="name" required>
            <input id="name" className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('admin.officeNamePlaceholder')} />
          </FormField>

          <FormField label={t('admin.officeCode')} htmlFor="officeCode" help={t('admin.officeCodeHelp')}>
            <input id="officeCode" className="form-input" value={form.officeCode} onChange={(e) => setForm((f) => ({ ...f, officeCode: e.target.value.toUpperCase() }))} placeholder="HA-MSU-01" />
          </FormField>

          <FormField label={t('admin.officeAddress')} htmlFor="address">
            <input id="address" className="form-input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </FormField>

          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form.isHeadOffice} onChange={(e) => setForm((f) => ({ ...f, isHeadOffice: e.target.checked }))} />
              {t('offices.headOffice')}
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? t('common.loading') : editingId ? t('admin.saveChanges') : t('admin.createOffice')}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} className="btn-secondary">{t('common.cancel')}</button>
          )}
        </div>
      </form>

      {offices && (
        <DataTable
          rowKey="office_id"
          rows={offices}
          emptyMessage={t('admin.noOfficesYet')}
          columns={[
            { key: 'name', header: t('admin.officeName'), render: (r) => (
              <span className="flex items-center gap-1.5">
                {r.name}
                {r.is_head_office && <span className="rounded-full bg-gov-navy/10 px-2 py-0.5 text-[11px] font-semibold text-gov-navy">{t('offices.headOffice')}</span>}
              </span>
            ) },
            { key: 'department_name', header: t('admin.department') },
            { key: 'district_name', header: t('offices.district'), render: (r) => (
              <span className="flex items-center gap-1"><MapPinIcon className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} />{r.district_name || '—'}</span>
            ) },
            { key: 'office_code', header: t('admin.officeCode'), render: (r) => r.office_code || '—' },
            { key: 'staff_count', header: t('admin.staffCount') },
            {
              key: 'actions', header: t('common.actions'),
              render: (r) => (
                <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => startEdit(r)}>
                  {t('common.edit')}
                </button>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
