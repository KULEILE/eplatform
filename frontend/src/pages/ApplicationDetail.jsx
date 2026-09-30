import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from '../components/ui/Loading';
import StatusBadge from '../components/ui/StatusBadge';
import Timeline from '../components/ui/Timeline';
import EmptyState from '../components/ui/EmptyState';

const SOURCE_ROUTE = {
  birth_records: (id) => `/home-affairs/birth-registration/${id}`,
  national_id_cards: (id) => `/home-affairs/national-id/${id}`,
};

export default function ApplicationDetail() {
  const { id } = useParams();
  const { t } = useLanguage();
  const [data, setData] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState('');
  const [loadError, setLoadError] = useState('');

  function load() {
    setLoadError('');
    api.get(`/applications/${id}`)
      .then(setData)
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  async function onUpload(e) {
    e.preventDefault();
    const file = e.target.elements.file.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('documentType', docType || 'Supporting Document');
    setUploading(true);
    try {
      await api.postForm(`/applications/${id}/documents`, fd);
      e.target.reset();
      setDocType('');
      load();
    } finally {
      setUploading(false);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon="⚠"
          title={t('common.somethingWentWrong')}
          message={loadError}
          action={<Link to="/applications" className="btn-secondary">{t('common.back')}</Link>}
        />
      </div>
    );
  }
  if (!data) return <Loading />;
  const { application, history, documents } = data;
  const deepLink = SOURCE_ROUTE[application.source_table]?.(application.source_id);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">{application.service_type}</h1>
      <p className="mt-1 font-mono text-sm text-slate-500">{application.reference_number}</p>

      <div className="card mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500">{t('applications.department')}</p>
          <p className="font-medium">{application.department_name}</p>
        </div>
        <StatusBadge status={application.status} />
        {deepLink && <Link to={deepLink} className="btn-secondary">{t('common.viewDetails')}</Link>}
      </div>

      <p className="mt-3 text-sm text-slate-600">{t(`statusHelp.${application.status}`)}</p>

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">{t('applications.timeline')}</h2>
      <div className="card">
        <Timeline history={history} />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">{t('applications.documents')}</h2>
      <div className="card">
        {documents.length === 0 ? (
          <p className="text-sm text-slate-500">{t('common.noResults')}</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {documents.map((d) => (
              <li key={d.document_id} className="flex items-center justify-between py-2 text-sm">
                <span>📎 {d.original_filename} <span className="text-slate-400">({d.document_type})</span></span>
                <StatusBadge status={d.verification_status} />
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={onUpload} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          <div className="flex-1">
            <label htmlFor="documentType" className="form-label">Document type</label>
            <input id="documentType" className="form-input" value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="e.g. Proof of Birth Notification" />
          </div>
          <div>
            <label htmlFor="file" className="form-label">{t('common.upload')}</label>
            <input id="file" name="file" type="file" className="text-sm" />
          </div>
          <button type="submit" disabled={uploading} className="btn-primary">{uploading ? t('common.loading') : t('common.upload')}</button>
        </form>
      </div>
    </div>
  );
}
