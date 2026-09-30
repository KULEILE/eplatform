import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from '../components/ui/Loading';
import DataTable from '../components/ui/DataTable';
import StatusBadge from '../components/ui/StatusBadge';
import { formatDateOnly } from '../utils/format';

/** Citizen: their own appointments, plus a way to book a new one. Employee/admin: their
 *  department's queue, with the accommodation notes shown up front so staff can actually
 *  prepare (arrange an interpreter, a ground-floor room, etc.) before the citizen arrives. */
export default function Appointments() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const isOfficer = user.roleKey !== 'citizen';

  function load() {
    api.get(`/appointments${statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''}`)
      .then((d) => setRows(d.appointments))
      .catch((err) => setError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [statusFilter]);

  async function setStatus(id, status) {
    setError('');
    try {
      await api.patch(`/appointments/${id}/status`, { status });
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    }
  }

  if (!rows) return <Loading />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{t('appointments.title')}</h1>
        {!isOfficer && <Link to="/appointments/apply" className="btn-primary">{t('appointments.bookNew')}</Link>}
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <select className="form-input mb-4 w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('common.filter')}>
        <option value="">{t('common.filter')}: {t('common.status')}</option>
        {['Scheduled', 'Completed', 'Missed', 'Cancelled'].map((s) => (
          <option key={s} value={s}>{t(`status.${s}`)}</option>
        ))}
      </select>

      <DataTable
        rowKey="appointment_id"
        rows={rows}
        emptyTitle={t('common.noResults')}
        columns={[
          {
            key: 'when', header: t('appointments.dateTime'),
            render: (r) => `${formatDateOnly(r.appointment_date)} · ${r.appointment_time?.slice(0, 5)}`,
          },
          ...(isOfficer ? [{ key: 'citizen', header: t('appointments.citizen'), render: (r) => `${r.first_name} ${r.last_name}` }] : [{ key: 'department_name', header: t('appointments.department') }]),
          { key: 'office_name', header: t('offices.branch'), render: (r) => r.office_name || '—' },
          { key: 'purpose', header: t('appointments.purpose'), render: (r) => t(`appointments.purposeOption.${r.purpose}`) },
          {
            key: 'accommodation', header: t('appointments.accommodation'),
            render: (r) => r.needs_interpreter || r.accommodation_notes ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800" title={r.accommodation_notes || ''}>
                ℹ {r.interpreter_language ? r.interpreter_language : t('appointments.accommodationRequested')}
              </span>
            ) : '—',
          },
          { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          {
            key: 'actions', header: t('common.actions'),
            render: (r) => {
              if (r.status !== 'Scheduled') {
                return <span className="text-sm text-slate-400">—</span>;
              }
              return (
                <div className="flex flex-wrap gap-2">
                  {isOfficer && (
                    <>
                      <button type="button" className="text-sm font-medium text-gov-green hover:underline" onClick={() => setStatus(r.appointment_id, 'Completed')}>{t('appointments.markCompleted')}</button>
                      <button type="button" className="text-sm font-medium text-gov-amber hover:underline" onClick={() => setStatus(r.appointment_id, 'Missed')}>{t('appointments.markMissed')}</button>
                    </>
                  )}
                  <button type="button" className="text-sm font-medium text-gov-red hover:underline" onClick={() => setStatus(r.appointment_id, 'Cancelled')}>{t('common.cancel')}</button>
                </div>
              );
            },
          },
        ]}
      />
    </div>
  );
}
