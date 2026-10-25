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
const emptyForm = { requestedDate: '', officeId: '' };

/**
 * Driving theory test booking (migration 067 rebuild): a citizen can only book the THEORY test —
 * it is auto-scheduled the moment they submit (no officer "schedule" step needed). The practical
 * test is created automatically once an officer records a passed theory result (see
 * recordTestResult() in trafficServices2.controller.js); it appears in this same table with no
 * citizen action required. An officer must set that specific theory sitting's questions and,
 * for a practical sitting, its location, before a result can be recorded — both open as small
 * modals here, with professional (btn-primary) buttons, same as Record Result.
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
      const result = await api.post(API_BASE, { testType: 'Theory', ...form });
      setSuccess(t('traffic.testBookingsForm.autoScheduled', { date: formatDateOnly(result.booking.confirmed_date) }));
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

  const hasTheoryBooked = (rows || []).some((r) => r.test_type === 'Theory' && ['Requested', 'Scheduled'].includes(r.status));

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('traffic.testBookings')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('traffic.testBookingsForm.introNew')}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      {hasTheoryBooked ? (
        <p className="mb-8 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{t('traffic.testBookingsForm.theoryAlreadyBooked')}</p>
      ) : (
        <form onSubmit={onSubmit} className="card mb-8" noValidate>
          <FormField label={t('traffic.testBookingsForm.field.requestedDate')} htmlFor="requestedDate" required help={t('traffic.testBookingsForm.autoScheduleHelp')}>
            <input id="requestedDate" type="date" min={new Date().toISOString().slice(0, 10)} required className="form-input" value={form.requestedDate} onChange={(e) => update('requestedDate', e.target.value)} />
          </FormField>
          <DistrictOfficeSelect departmentKey="traffic" value={form.officeId} onChange={(id) => update('officeId', id)} />
          <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('traffic.testBookingsForm.bookTheory')}</button>
        </form>
      )}

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
            { key: 'location', header: t('traffic.testBookingsForm.field.location'), render: (r) => r.test_location || '—' },
            { key: 'marks', header: t('traffic.testBookingsForm.field.marks'), render: (r) => r.marks ?? '—' },
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
  const [reasonTarget, setReasonTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [questionsTarget, setQuestionsTarget] = useState(null);
  const [questions, setQuestions] = useState(['']);
  const [locationTarget, setLocationTarget] = useState(null);
  const [testLocation, setTestLocation] = useState('');
  const [resultTarget, setResultTarget] = useState(null);
  const [resultValue, setResultValue] = useState('Passed');
  const [marksValue, setMarksValue] = useState('');

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
    await act(reasonTarget, 'reject', { reason });
    setReasonTarget(null); setReason('');
  }

  async function onQuestionsSubmit(e) {
    e.preventDefault();
    if (!questionsTarget) return;
    await act(questionsTarget, 'questions', { questions: questions.map((q) => q.trim()).filter(Boolean) });
    setQuestionsTarget(null); setQuestions(['']);
  }

  async function onLocationSubmit(e) {
    e.preventDefault();
    if (!locationTarget || !testLocation.trim()) return;
    await act(locationTarget, 'set-location', { testLocation: testLocation.trim() });
    setLocationTarget(null); setTestLocation('');
  }

  async function onResultSubmit(e) {
    e.preventDefault();
    if (!resultTarget) return;
    await act(resultTarget, 'record-result', { result: resultValue, marks: marksValue === '' ? undefined : Number(marksValue) });
    setResultTarget(null); setResultValue('Passed'); setMarksValue('');
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('traffic.testBookings')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('traffic.testBookingsForm.introOfficer')}</p>

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
            { key: 'location', header: t('traffic.testBookingsForm.field.location'), render: (r) => r.test_location || '—' },
            { key: 'questions', header: t('traffic.testBookingsForm.field.questions'), render: (r) => r.test_type === 'Theory' ? (r.theory_questions ? `✓ (${r.theory_questions.length})` : '—') : '—' },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions', header: t('common.actions'),
              render: (r) => {
                const rowBusy = busy === r.driving_test_booking_id;
                if (r.status === 'Requested') {
                  return <button type="button" disabled={rowBusy} className="text-xs font-semibold text-gov-red underline" onClick={() => setReasonTarget(r.driving_test_booking_id)}>{t('common.reject')}</button>;
                }
                if (r.status !== 'Scheduled') return null;
                const needsQuestions = r.test_type === 'Theory' && !r.theory_questions;
                const needsLocation = r.test_type === 'Practical' && !r.test_location;
                return (
                  <div className="flex flex-wrap gap-2">
                    {needsQuestions && (
                      <button type="button" disabled={rowBusy} className="btn-primary !whitespace-nowrap !px-3 !py-1.5 !text-xs" onClick={() => { setQuestionsTarget(r.driving_test_booking_id); setQuestions(['']); }}>
                        {t('traffic.testBookingsForm.setQuestions')}
                      </button>
                    )}
                    {needsLocation && (
                      <button type="button" disabled={rowBusy} className="btn-primary !whitespace-nowrap !px-3 !py-1.5 !text-xs" onClick={() => { setLocationTarget(r.driving_test_booking_id); setTestLocation(''); }}>
                        {t('traffic.testBookingsForm.setLocation')}
                      </button>
                    )}
                    {!needsQuestions && !needsLocation && (
                      <button type="button" disabled={rowBusy} className="btn-primary !whitespace-nowrap !px-3 !py-1.5 !text-xs" onClick={() => { setResultTarget(r.driving_test_booking_id); setResultValue('Passed'); setMarksValue(''); }}>
                        {t('traffic.testBookingsForm.recordResult')}
                      </button>
                    )}
                    <button type="button" disabled={rowBusy} className="text-xs font-semibold text-gov-red underline" onClick={() => setReasonTarget(r.driving_test_booking_id)}>{t('common.reject')}</button>
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <Modal open={!!reasonTarget} onClose={() => setReasonTarget(null)} title={t('common.reject')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setReasonTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="reject-form" className="btn-danger">{t('common.submit')}</button>
        </>}
      >
        <form id="reject-form" onSubmit={onReasonSubmit} noValidate>
          <FormField label={t('services.reason')} htmlFor="t-reason" required>
            <textarea id="t-reason" required rows={3} className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
        </form>
      </Modal>

      <Modal open={!!questionsTarget} onClose={() => setQuestionsTarget(null)} title={t('traffic.testBookingsForm.setQuestions')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setQuestionsTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="questions-form" disabled={!questions.some((q) => q.trim())} className="btn-primary">{t('common.confirm')}</button>
        </>}
      >
        <form id="questions-form" onSubmit={onQuestionsSubmit} noValidate>
          <p className="mb-3 text-sm text-slate-600">{t('traffic.testBookingsForm.questionsHelp')}</p>
          {questions.map((q, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input
                type="text" className="form-input" value={q}
                onChange={(e) => setQuestions((qs) => qs.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={t('traffic.testBookingsForm.questionPlaceholder', { n: i + 1 })}
              />
              {questions.length > 1 && (
                <button type="button" className="text-xs font-semibold text-gov-red underline" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}>{t('common.remove')}</button>
              )}
            </div>
          ))}
          <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => setQuestions((qs) => [...qs, ''])}>+ {t('traffic.testBookingsForm.addQuestion')}</button>
        </form>
      </Modal>

      <Modal open={!!locationTarget} onClose={() => setLocationTarget(null)} title={t('traffic.testBookingsForm.setLocation')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setLocationTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="location-form" disabled={!testLocation.trim()} className="btn-primary">{t('common.confirm')}</button>
        </>}
      >
        <form id="location-form" onSubmit={onLocationSubmit} noValidate>
          <FormField label={t('traffic.testBookingsForm.field.location')} htmlFor="testLocation" required>
            <input id="testLocation" type="text" required className="form-input" value={testLocation} onChange={(e) => setTestLocation(e.target.value)} />
          </FormField>
        </form>
      </Modal>

      <Modal open={!!resultTarget} onClose={() => setResultTarget(null)} title={t('traffic.testBookingsForm.recordResult')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setResultTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="result-form" className={resultValue === 'Passed' ? 'btn-primary' : 'btn-danger'}>{t('common.confirm')}</button>
        </>}
      >
        <form id="result-form" onSubmit={onResultSubmit} noValidate>
          <FormField label={t('traffic.testBookingsForm.result')} htmlFor="resultValue" required>
            <select id="resultValue" className="form-input" value={resultValue} onChange={(e) => setResultValue(e.target.value)}>
              <option value="Passed">{t('traffic.testBookingsForm.recordPass')}</option>
              <option value="Failed">{t('traffic.testBookingsForm.recordFail')}</option>
            </select>
          </FormField>
          <FormField label={t('traffic.testBookingsForm.field.marks')} htmlFor="marksValue" help={t('common.optional')}>
            <input id="marksValue" type="number" min="0" max="100" className="form-input" value={marksValue} onChange={(e) => setMarksValue(e.target.value)} />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
