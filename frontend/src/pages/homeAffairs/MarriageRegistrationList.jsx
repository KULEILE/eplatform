import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';

export default function MarriageRegistrationList() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  useEffect(() => {
    api.get(`/home-affairs/marriage-registration${statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''}`)
      .then((d) => setRows(d.marriageRegistrations));
  }, [statusFilter]);

  if (!rows) return <Loading />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('homeAffairs.marriageRegistration')}</h1>
        {!isOfficer && <Link to="/home-affairs/marriage-registration/apply" className="btn-primary">{t('homeAffairs.marriageForm.submit')}</Link>}
      </div>

      {isOfficer && (
        <select className="form-input mb-4 w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{t('common.filter')}: {t('common.status')}</option>
          {['Submitted', 'Under Review', 'Additional Information Required', 'Verified', 'Approved', 'Rejected'].map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
      )}

      <DataTable
        rowKey="marriage_record_id"
        rows={rows}
        columns={[
          { key: 'registration_reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.registration_reference}</span> },
          { key: 'spouse2_name', header: t('homeAffairs.marriageForm.spouseName') },
          { key: 'marriage_type', header: t('homeAffairs.marriageForm.marriageType'), render: (r) => t(`homeAffairs.marriageForm.${r.marriage_type.toLowerCase()}`) },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          {
            key: 'view', header: t('common.actions'),
            render: (r) => <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => navigate(`/home-affairs/marriage-registration/${r.marriage_record_id}`)}>{t('common.viewDetails')}</button>,
          },
        ]}
      />
    </div>
  );
}
