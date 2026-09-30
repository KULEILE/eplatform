import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useSystemSettings } from '../../context/SystemSettingsContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import FormField from '../../components/ui/FormField';

export default function AdminSettings() {
  const { t } = useLanguage();
  const { refresh } = useSystemSettings();
  const [settings, setSettings] = useState(null);
  const [systemName, setSystemName] = useState('');
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api.get('/admin/settings').then((d) => { setSettings(d.settings); setSystemName(d.settings.system_name); });
  }
  useEffect(() => { load(); }, []);

  async function saveName(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.put('/admin/settings', { system_name: systemName });
      load();
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('logo', file);
      await api.postForm('/admin/logo', fd);
      setFile(null);
      load();
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    setBusy(true);
    try { await api.del('/admin/logo'); load(); refresh(); } finally { setBusy(false); }
  }

  if (!settings) return <Loading />;
  const logoUrl = settings.government_logo_reference ? `/uploads/${settings.government_logo_reference}` : null;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('admin.systemSettings')}</h1>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <form onSubmit={saveName} className="card mb-6">
        <FormField label={t('admin.systemName')} htmlFor="systemName">
          <input id="systemName" className="form-input" value={systemName} onChange={(e) => setSystemName(e.target.value)} />
        </FormField>
        <button type="submit" disabled={busy} className="btn-primary">{t('common.save')}</button>
      </form>

      <div className="card">
        <h2 className="mb-4 font-semibold text-slate-800">{t('admin.governmentLogo')}</h2>
        <div className="mb-4 flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded border border-slate-200 bg-slate-50">
            {logoUrl ? <img src={logoUrl} alt="Government logo preview" className="max-h-full max-w-full object-contain" /> : <span className="text-3xl" aria-hidden="true">🏛️</span>}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">{t('admin.preview')}</p>
            <p className="text-xs text-slate-500">{logoUrl ? 'Custom logo in use' : `Fallback: ${t('admin.noLogoFallback')}`}</p>
          </div>
        </div>
        <form onSubmit={uploadLogo} className="flex flex-wrap items-center gap-3">
          <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => setFile(e.target.files[0])} className="text-sm" />
          <button type="submit" disabled={busy || !file} className="btn-primary">{t('admin.uploadLogo')}</button>
          {logoUrl && <button type="button" disabled={busy} onClick={removeLogo} className="btn-secondary">{t('admin.removeLogo')}</button>}
        </form>
        <p className="mt-2 text-xs text-slate-500">PNG, JPG or SVG. Maximum 2MB.</p>
      </div>
    </div>
  );
}
