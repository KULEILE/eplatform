import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import FormField from '../../components/ui/FormField';
import Modal from '../../components/ui/Modal';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';
import { formatDateOnly } from '../../utils/format';

const API_BASE = '/traffic/test-bookings';
const emptyForm = { testType: 'Theory', requestedDate: '', officeId: '' };

/**
 * Driving theory test & practical driving test booking, combined into one page (covers both of
 * the two approved service-list items) since they share the same booking UI — only the
 * eligibility rule differs, and that is enforced server-side (see trafficServices2.controller.js):
 * a Theory test requires an Approved Learner Permit on record, a Practical test additionally
 * requires a Passed Theory test. A citizen cannot book either without the prerequisite already
 * in place — the backend rejects the booking with a clear reason if it's missing.
 */
export default function DrivingTestBookings() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['traffic_officer', 'system_administrator'].includes(user.roleKey);
  return isOfficer ? <OfficerQueue t={t} /> : <CitizenView t={t} />;
}

function CitizenView({ t }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  function load() { api.get(API_BASE).then((d) => setRows(d.bookings)).catch(() => setRows([])); }
  useEffect(() => { load(); }, []);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setBusy(true);
    try {
      const result = await api.post(API_BASE, form);
      setSuccess(t('services.submittedWithReference', { reference: result.booking.booking_reference }));
      setForm(emptyForm);
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  async function onCancel(id) {
    setError(''); setSuccess(''); setBusy(true);
    try {
      await api.post(`${API_BASE}/${id}/cancel`, {});
      setSuccess(t('traffic.testBookingsForm.cancelled'));
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('traffic.testBookings')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('traffic.testBookingsForm.intro')}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      <form onSubmit={onSubmit} className="card mb-8" noValidate>
        <FormField label={t('traffic.testBookingsForm.field.testType')} htmlFor="testType" required>
          <select id="testType" required className="form-input" value={form.testType} onChange={(e) => update('testType', e.target.value)}>
            <option value="Theory">{t('traffic.testType.theory')}</option>
            <option value="Practical">{t('traffic.testType.practical')}</option>
          </select>
        </FormField>
        <FormField label={t('traffic.testBookingsForm.field.requestedDate')} htmlFor="requestedDate" required>
          <input id="requestedDate" type="date" required className="form-input" value={form.requestedDate} onChange={(e) => update('requestedDate', e.target.value)} />
        </FormField>
        <DistrictOfficeSelect departmentKey="traffic" value={form.officeId} onChange={(id) => update('officeId', id)} />
        <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('common.submit')}</button>
      </form>

      <h2 className="mb-3 text-lg font-semibold text-slate-900">{t('services.myRequests')}</h2>
      {!rows ? <Loading /> : (
        <DataTable
          rowKey="driving_test_booking_id"
          rows={rows}
          emptyTitle={t('common.noResults')}
          columns={[
            { key: 'reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.booking_reference}</span> },
            { key: 'testType', header: t('traffic.testBookingsForm.field.testType'), render: (r) => t(`traffic.testType.${r.test_type.toLowerCase()}`) },
            { key: 'date', header: t('traffic.testBookingsForm.field.requestedDate'), render: (r) => formatDateOnly(r.confirmed_date || r.requested_date) },
            { key: 'result', header: t('traffic.testBookingsForm.result'), render: (r) => r.result === 'Pending' ? '—' : <StatusBadge status={r.result} kind={r.result === 'Passed' ? 'positive' : 'negative'} /> },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions', header: t('common.actions'),
              render: (r) => ['Requested', 'Scheduled'].includes(r.status) ? (
                <button type="button" disabled={busy} className="text-xs font-semibold text-gov-red underline" onClick={() => onCancel(r.driving_test_booking_id)}>{t('common.cancel')}</button>
              ) : null,
            },
          ]}
        />
      )}
    </div>
  );
}

function OfficerQueue({ t }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(null);
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [confirmedDate, setConfirmedDate] = useState('');
  const [reasonTarget, setReasonTarget] = useState(null);
  const [reason, setReason] = useState('');

  function load() { api.get(API_BASE).then((d) => setRows(d.bookings)).catch(() => setRows([])); }
  useEffect(() => { load(); }, []);

  async function act(id, action, body) {
    setError(''); setSuccess(''); setBusy(id);
    try {
      await api.post(`${API_BASE}/${id}/${action}`, body);
      setSuccess(t('services.actionRecorded'));
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(null); }
  }

  async function onScheduleSubmit(e) {
    e.preventDefault();
    if (!scheduleTarget || !confirmedDate) return;
    await act(scheduleTarget, 'schedule', { confirmedDate });
    setScheduleTarget(null); setConfirmedDate('');
  }

  async function onReasonSubmit(e) {
    e.preventDefault();
    if (!reasonTarget) return;
    await act(reasonTarget, 'reject', { reason });
    setReasonTarget(null); setReason('');
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('traffic.testBookings')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('traffic.testBookingsForm.intro')}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      {!rows ? <Loading /> : (
        <DataTable
          rowKey="driving_test_booking_id"
          rows={rows}
          emptyTitle={t('common.noResults')}
          columns={[
            { key: 'reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.booking_reference}</span> },
            { key: 'citizen', header: t('common.citizen'), render: (r) => `${r.first_name} ${r.last_name}` },
            { key: 'testType', header: t('traffic.testBookingsForm.field.testType'), render: (r) => t(`traffic.testType.${r.test_type.toLowerCase()}`) },
            { key: 'date', header: t('traffic.testBookingsForm.field.requestedDate'), render: (r) => formatDateOnly(r.confirmed_date || r.requested_date) },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions', header: t('common.actions'),
              render: (r) => (
                <div className="flex flex-wrap gap-2">
                  {r.status === 'Requested' && (
                    <>
                      <button type="button" disabled={busy === r.driving_test_booking_id} className="text-xs font-semibold text-gov-navy underline" onClick={() => setScheduleTarget(r.driving_test_booking_id)}>{t('traffic.testBookingsForm.schedule')}</button>
                      <button type="button" disabled={busy === r.driving_test_booking_id} className="text-xs font-semibold text-gov-red underline" onClick={() => setReasonTarget(r.driving_test_booking_id)}>{t('common.reject')}</button>
                    </>
                  )}
                  {r.status === 'Scheduled' && (
                    <>
                      <button type="button" disabled={busy === r.driving_test_booking_id} className="text-xs font-semibold text-gov-green underline" onClick={() => act(r.driving_test_booking_id, 'record-result', { result: 'Passed' })}>{t('traffic.testBookingsForm.recordPass')}</button>
                      <button type="button" disabled={busy === r.driving_test_booking_id} className="text-xs font-semibold text-gov-red underline" onClick={() => act(r.driving_test_booking_id, 'record-result', { result: 'Failed' })}>{t('traffic.testBookingsForm.recordFail')}</button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={!!scheduleTarget} onClose={() => setScheduleTarget(null)} title={t('traffic.testBookingsForm.schedule')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setScheduleTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="schedule-form" disabled={!confirmedDate} className="btn-primary">{t('common.confirm')}</button>
        </>}
      >
        <form id="schedule-form" onSubmit={onScheduleSubmit} noValidate>
          <FormField label={t('traffic.testBookingsForm.field.confirmedDate')} htmlFor="confirmedDate" required>
            <input id="confirmedDate" type="date" required className="form-input" value={confirmedDate} onChange={(e) => setConfirmedDate(e.target.value)} />
          </FormField>
        </form>
      </Modal>

      <Modal open={!!reasonTarget} onClose={() => setReasonTarget(null)} title={t('common.reject')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setReasonTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="reject-form" className="btn-primary">{t('common.submit')}</button>
        </>}
      >
        <form id="reject-form" onSubmit={onReasonSubmit} noValidate>
          <FormField label={t('services.reason')} htmlFor="t-reason" required>
            <textarea id="t-reason" required rows={3} className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
