import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from '../components/ui/Loading';
import DataTable from '../components/ui/DataTable';
import StatusBadge from '../components/ui/StatusBadge';

export default function Applications() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [applications, setApplications] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    api.get(`/applications${statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''}`)
      .then((d) => setApplications(d.applications));
  }, [statusFilter]);

  if (!applications) return <Loading />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('applications.title')}</h1>
        <select className="form-input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('common.filter')}>
          <option value="">{t('common.filter')}: {t('common.status')}</option>
          {['Submitted', 'Under Review', 'Processing', 'Approved', 'Ready for Collection', 'Collected', 'Rejected', 'Completed'].map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
      </div>

      <DataTable
        rowKey="application_id"
        emptyTitle={t('common.noResults')}
        rows={applications}
        columns={[
          { key: 'reference_number', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.reference_number}</span> },
          { key: 'department_name', header: t('applications.department') },
          { key: 'service_type', header: t('applications.service') },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          { key: 'submitted_at', header: t('applications.submittedOn'), render: (r) => new Date(r.submitted_at).toLocaleDateString() },
          {
            key: 'view', header: t('common.actions'),
            render: (r) => (
              <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => navigate(`/applications/${r.application_id}`)}>
                {t('common.viewDetails')}
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}
