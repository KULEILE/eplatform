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

const API_BASE = '/home-affairs/marriage-solemnisation';
const emptyForm = { spouse1Name: '', spouse2Name: '', officeId: '', requestedDate: '', requestedTime: '' };

/**
 * Civil marriage solemnisation — booking the ceremony itself (an officiant and a branch on a
 * date), as opposed to registering a marriage that already happened (MarriageRegistration*).
 * A calendar booking rather than a document approval: Requested -> Confirmed -> Completed, with
 * Cancel available to the citizen or an officer at any point before completion — see
 * backend/src/controllers/homeAffairsServices2.controller.js's "confirm/complete/cancel" actions.
 */
export default function MarriageSolemnisation() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);
  return isOfficer ? <OfficerQueue t={t} /> : <CitizenView t={t} />;
}

function CitizenView({ t }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(null);

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

  function startEdit(row) {
    setEditTarget(row.booking_id);
    setEditForm({ spouse1Name: row.spouse1_name, spouse2Name: row.spouse2_name, officeId: row.office_id, requestedDate: row.requested_date, requestedTime: row.requested_time || '' });
    setError(''); setSuccess('');
  }

  async function onResubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setBusy(true);
    try {
      await api.post(`${API_BASE}/${editTarget}/resubmit`, editForm);
      setSuccess(t('services.resubmitted'));
      setEditTarget(null); setEditForm(null);
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  async function onCancel(id) {
    setError(''); setSuccess(''); setBusy(true);
    try {
      await api.post(`${API_BASE}/${id}/cancel`);
      setSuccess(t('homeAffairs.solemnisationForm.cancelled'));
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.solemnisation')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('homeAffairs.solemnisationForm.intro')}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      <form onSubmit={onSubmit} className="card mb-8" noValidate>
        <FormField label={t('homeAffairs.solemnisationForm.field.spouse1Name')} htmlFor="spouse1Name" required>
          <input id="spouse1Name" required className="form-input" value={form.spouse1Name} onChange={(e) => update('spouse1Name', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.solemnisationForm.field.spouse2Name')} htmlFor="spouse2Name" required>
          <input id="spouse2Name" required className="form-input" value={form.spouse2Name} onChange={(e) => update('spouse2Name', e.target.value)} />
        </FormField>
        <DistrictOfficeSelect departmentKey="home_affairs" value={form.officeId} onChange={(id) => update('officeId', id)} />
        <FormField label={t('homeAffairs.solemnisationForm.field.requestedDate')} htmlFor="requestedDate" required>
          <input id="requestedDate" type="date" required className="form-input" value={form.requestedDate} onChange={(e) => update('requestedDate', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.solemnisationForm.field.requestedTime')} htmlFor="requestedTime" help={t('common.optional')}>
          <input id="requestedTime" type="time" className="form-input" value={form.requestedTime} onChange={(e) => update('requestedTime', e.target.value)} />
        </FormField>
        <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('common.submit')}</button>
      </form>

      <h2 className="mb-3 text-lg font-semibold text-slate-900">{t('services.myRequests')}</h2>
      {!rows ? <Loading /> : (
        <DataTable
          rowKey="booking_id"
          rows={rows}
          emptyTitle={t('common.noResults')}
          columns={[
            { key: 'reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.booking_reference}</span> },
            { key: 'spouses', header: t('homeAffairs.solemnisationForm.spouses'), render: (r) => `${r.spouse1_name} & ${r.spouse2_name}` },
            { key: 'office', header: t('offices.branch'), render: (r) => r.office_name || '—' },
            { key: 'date', header: t('homeAffairs.solemnisationForm.field.requestedDate'), render: (r) => formatDateOnly(r.confirmed_date || r.requested_date) },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions', header: t('common.actions'),
              render: (r) => (
                <div className="flex flex-wrap gap-2">
                  {['Additional Information Required', 'Rejected'].includes(r.status) && (
                    <button type="button" className="text-xs font-semibold text-gov-navy underline" onClick={() => startEdit(r)}>{t('common.editAndResubmit')}</button>
                  )}
                  {['Requested', 'Confirmed', 'Additional Information Required'].includes(r.status) && (
                    <button type="button" disabled={busy} className="text-xs font-semibold text-gov-red underline" onClick={() => onCancel(r.booking_id)}>{t('common.cancel')}</button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={t('common.editAndResubmit')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="solemnisation-resubmit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('common.resubmitForReview')}</button>
        </>}
      >
        {editForm && (
          <form id="solemnisation-resubmit" onSubmit={onResubmit} noValidate>
            <FormField label={t('homeAffairs.solemnisationForm.field.spouse1Name')} htmlFor="e-spouse1Name" required>
              <input id="e-spouse1Name" required className="form-input" value={editForm.spouse1Name} onChange={(e) => setEditForm((f) => ({ ...f, spouse1Name: e.target.value }))} />
            </FormField>
            <FormField label={t('homeAffairs.solemnisationForm.field.spouse2Name')} htmlFor="e-spouse2Name" required>
              <input id="e-spouse2Name" required className="form-input" value={editForm.spouse2Name} onChange={(e) => setEditForm((f) => ({ ...f, spouse2Name: e.target.value }))} />
            </FormField>
            <DistrictOfficeSelect departmentKey="home_affairs" value={editForm.officeId} onChange={(id) => setEditForm((f) => ({ ...f, officeId: id }))} />
            <FormField label={t('homeAffairs.solemnisationForm.field.requestedDate')} htmlFor="e-requestedDate" required>
              <input id="e-requestedDate" type="date" required className="form-input" value={editForm.requestedDate} onChange={(e) => setEditForm((f) => ({ ...f, requestedDate: e.target.value }))} />
            </FormField>
          </form>
        )}
      </Modal>
    </div>
  );
}

function OfficerQueue({ t }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(null);
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

  async function onReasonSubmit(e) {
    e.preventDefault();
    if (!reasonTarget) return;
    await act(reasonTarget.id, reasonTarget.action, { reason });
    setReasonTarget(null); setReason('');
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.solemnisation')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('homeAffairs.solemnisationForm.intro')}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      {!rows ? <Loading /> : (
        <DataTable
          rowKey="booking_id"
          rows={rows}
          emptyTitle={t('common.noResults')}
          columns={[
            { key: 'reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.booking_reference}</span> },
            { key: 'citizen', header: t('common.citizen'), render: (r) => `${r.first_name} ${r.last_name}` },
            { key: 'spouses', header: t('homeAffairs.solemnisationForm.spouses'), render: (r) => `${r.spouse1_name} & ${r.spouse2_name}` },
            { key: 'office', header: t('offices.branch'), render: (r) => r.office_name || '—' },
            { key: 'date', header: t('homeAffairs.solemnisationForm.field.requestedDate'), render: (r) => formatDateOnly(r.confirmed_date || r.requested_date) },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions', header: t('common.actions'),
              render: (r) => (
                <div className="flex flex-wrap gap-2">
                  {r.status === 'Requested' && (
                    <>
                      <button type="button" disabled={busy === r.booking_id} className="text-xs font-semibold text-gov-amber underline" onClick={() => setReasonTarget({ id: r.booking_id, action: 'request-information' })}>{t('services.requestInfo')}</button>
                      <button type="button" disabled={busy === r.booking_id} className="text-xs font-semibold text-gov-green underline" onClick={() => act(r.booking_id, 'confirm')}>{t('homeAffairs.solemnisationForm.confirm')}</button>
                      <button type="button" disabled={busy === r.booking_id} className="text-xs font-semibold text-gov-red underline" onClick={() => setReasonTarget({ id: r.booking_id, action: 'reject' })}>{t('common.reject')}</button>
                    </>
                  )}
                  {r.status === 'Confirmed' && (
                    <>
                      <button type="button" disabled={busy === r.booking_id} className="text-xs font-semibold text-gov-green underline" onClick={() => act(r.booking_id, 'complete')}>{t('homeAffairs.solemnisationForm.markCompleted')}</button>
                      <button type="button" disabled={busy === r.booking_id} className="text-xs font-semibold text-gov-red underline" onClick={() => act(r.booking_id, 'cancel')}>{t('common.cancel')}</button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={!!reasonTarget} onClose={() => setReasonTarget(null)} title={reasonTarget?.action === 'reject' ? t('common.reject') : t('services.requestInfo')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setReasonTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="solemnisation-reason" className="btn-primary">{t('common.submit')}</button>
        </>}
      >
        <form id="solemnisation-reason" onSubmit={onReasonSubmit} noValidate>
          <FormField label={t('services.reason')} htmlFor="s-reason" required>
            <textarea id="s-reason" required rows={3} className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
