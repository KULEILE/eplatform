import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import DataTable from '../../components/ui/DataTable';

const DEPARTMENTS = ['home_affairs', 'traffic', 'finance', 'pensions', 'police', 'passport'];

export default function AdminAudit() {
  const { t } = useLanguage();
  const [logs, setLogs] = useState(null);
  const [dept, setDept] = useState('');

  useEffect(() => {
    api.get(`/audit-logs${dept ? `?department=${dept}` : ''}`).then((d) => setLogs(d.auditLogs));
  }, [dept]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('admin.auditLog')}</h1>
        <select className="form-input w-auto" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">{t('common.filter')}: {t('admin.department')}</option>
          {DEPARTMENTS.map((d) => <option key={d} value={d}>{t(`departments.${d}`)}</option>)}
        </select>
      </div>
      {logs && (
        <DataTable
          rowKey="audit_log_id"
          rows={logs}
          columns={[
            { key: 'created_at', header: t('common.date'), render: (r) => new Date(r.created_at).toLocaleString() },
            { key: 'user_email', header: 'User', render: (r) => r.user_email || 'system' },
            { key: 'department_name', header: t('admin.department'), render: (r) => r.department_name || '—' },
            { key: 'action', header: 'Action' },
            { key: 'target_type', header: 'Target', render: (r) => `${r.target_type}${r.target_id ? ` #${r.target_id}` : ''}` },
            { key: 'reason', header: t('common.reason'), render: (r) => r.reason || '—' },
          ]}
        />
      )}
    </div>
  );
}
