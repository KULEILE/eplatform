import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';

export default function NationalIdList() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  useEffect(() => { api.get('/home-affairs/national-id').then((d) => setRows(d.nationalIdCards)); }, []);

  if (!rows) return <Loading />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('homeAffairs.nationalIdCard')}</h1>
        {!isOfficer && <Link to="/home-affairs/national-id/apply" className="btn-primary">{t('homeAffairs.nationalIdForm.submit')}</Link>}
      </div>
      <DataTable
        rowKey="national_id_card_id"
        rows={rows}
        columns={[
          { key: 'card_number', header: 'Card number', render: (r) => <span className="font-mono text-xs">{r.card_number || '—'}</span> },
          ...(isOfficer ? [{ key: 'name', header: 'Citizen', render: (r) => `${r.first_name} ${r.last_name}` }] : []),
          { key: 'production_status', header: t('common.status'), render: (r) => <StatusBadge status={r.production_status} /> },
          {
            key: 'view', header: t('common.actions'),
            render: (r) => <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => navigate(`/home-affairs/national-id/${r.national_id_card_id}`)}>{t('common.viewDetails')}</button>,
          },
        ]}
      />
    </div>
  );
}
