import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import FormField from '../../components/ui/FormField';
import { formatDateOnly } from '../../utils/format';

const TYPES = ['Budget Document', 'Tender Announcement'];
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/png,image/jpeg';

/**
 * Budget and Tender Information. Everyone signed in can read and download what is published;
 * Finance officers (and the system administrator) can publish new documents and remove/restore
 * them. Backend: GET/POST /api/finance/publications, PATCH /api/finance/publications/:id.
 */
export default function BudgetAndTenders() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['finance_officer', 'system_administrator'].includes(user.roleKey);
  const [publications, setPublications] = useState(null);
  const [error, setError] = useState('');

  function load() {
    api.get('/finance/publications')
      .then((d) => setPublications(d.publications))
      .catch((err) => { setError(err.message); setPublications([]); });
  }
  useEffect(() => { load(); }, []);

  async function toggleActive(p) {
    setError('');
    try {
      await api.patch(`/finance/publications/${p.publication_id}`, { isActive: !p.is_active });
      load();
    } catch (err) { setError(err.message); }
  }

  if (!publications) return <Loading />;

  return (
    <div>
      <p className="mb-4 text-sm">
        <Link to="/finance" className="font-medium text-gov-navy hover:underline">&larr; {t('finance.title')}</Link>
      </p>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('finance.publications.title')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('finance.publications.intro')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      {isOfficer && <PublishForm onPublished={load} />}

      <PublicationSection
        title={t('finance.publications.budgetDocuments')}
        items={publications.filter((p) => p.publication_type === 'Budget Document')}
        isOfficer={isOfficer} onToggle={toggleActive}
      />
      <PublicationSection
        title={t('finance.publications.tenderAnnouncements')}
        items={publications.filter((p) => p.publication_type === 'Tender Announcement')}
        isOfficer={isOfficer} onToggle={toggleActive}
      />
    </div>
  );
}

function PublicationSection({ title, items, isOfficer, onToggle }) {
  const { t } = useLanguage();
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{t('finance.publications.noPublications')}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.publication_id} className={`card ${p.is_active ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">
                    {p.title}
                    {!p.is_active && (
                      <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">{t('finance.publications.inactiveTag')}</span>
                    )}
                  </p>
                  {p.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{p.description}</p>}
                  <p className="mt-2 text-xs text-slate-500">
                    {p.fiscal_year && <>{t('finance.publications.fiscalYear')}: {p.fiscal_year} · </>}
                    {p.tender_deadline && <>{t('finance.publications.tenderDeadline')}: {formatDateOnly(p.tender_deadline)} · </>}
                    {t('finance.publications.publishedOn')}: {formatDateOnly(p.created_at)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <a href={`/uploads/${p.file_reference}`} target="_blank" rel="noreferrer" className="btn-primary text-sm">
                    {t('finance.publications.downloadAction')}
                  </a>
                  {isOfficer && (
                    <button type="button" className="text-xs font-medium text-slate-600 hover:underline" onClick={() => onToggle(p)}>
                      {p.is_active ? t('finance.publications.deactivate') : t('finance.publications.activate')}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PublishForm({ onPublished }) {
  const { t } = useLanguage();
  const empty = { publicationType: TYPES[0], title: '', description: '', fiscalYear: '', tenderDeadline: '' };
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0); // remounts the file input to clear it after publishing
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isBudget = form.publicationType === 'Budget Document';
  const canSubmit = form.title.trim() && file && (isBudget ? form.fiscalYear.trim() : form.tenderDeadline);

  function set(name, value) { setForm((f) => ({ ...f, [name]: value })); }

  function onFile(e) {
    const f = e.target.files?.[0] || null;
    setError('');
    if (f && f.size > MAX_BYTES) { setError('Document is too large (maximum 8MB).'); setFile(null); return; }
    setFile(f);
  }

  async function submit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('publicationType', form.publicationType);
      fd.append('title', form.title.trim());
      fd.append('description', form.description.trim());
      if (isBudget) fd.append('fiscalYear', form.fiscalYear.trim());
      else fd.append('tenderDeadline', form.tenderDeadline);
      fd.append('file', file);
      await api.postForm('/finance/publications', fd);
      setSuccess(t('finance.publications.published'));
      setForm(empty); setFile(null); setFileKey((k) => k + 1);
      onPublished();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mb-8" noValidate>
      <h2 className="mb-4 text-lg font-semibold text-slate-900">{t('finance.publications.createTitle')}</h2>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      <FormField label={t('finance.publications.typeLabel')} htmlFor="pubType" required>
        <select id="pubType" className="form-input" value={form.publicationType} onChange={(e) => set('publicationType', e.target.value)}>
          {TYPES.map((ty) => <option key={ty} value={ty}>{t(`finance.publications.type.${ty}`)}</option>)}
        </select>
      </FormField>
      <FormField label={t('finance.publications.titleLabel')} htmlFor="pubTitle" required>
        <input id="pubTitle" className="form-input" value={form.title} onChange={(e) => set('title', e.target.value)} />
      </FormField>
      <FormField label={t('finance.publications.descriptionLabel')} htmlFor="pubDesc" help={t('common.optional')}>
        <textarea id="pubDesc" rows={3} className="form-input" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </FormField>
      {isBudget ? (
        <FormField label={t('finance.publications.fiscalYear')} htmlFor="pubYear" required help="e.g. 2026/27">
          <input id="pubYear" className="form-input" value={form.fiscalYear} onChange={(e) => set('fiscalYear', e.target.value)} />
        </FormField>
      ) : (
        <FormField label={t('finance.publications.tenderDeadline')} htmlFor="pubDeadline" required>
          <input id="pubDeadline" type="date" className="form-input" value={form.tenderDeadline} onChange={(e) => set('tenderDeadline', e.target.value)} />
        </FormField>
      )}
      <FormField label={t('finance.publications.fileLabel')} htmlFor="pubFile" required>
        <input key={fileKey} id="pubFile" type="file" accept={ACCEPT} className="form-input" onChange={onFile} />
      </FormField>

      <button type="submit" className="btn-primary" disabled={busy || !canSubmit}>{t('finance.publications.publishAction')}</button>
    </form>
  );
}
