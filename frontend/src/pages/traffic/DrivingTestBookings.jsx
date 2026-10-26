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
const SESSIONS_BASE = '/traffic/theory-sessions';
const emptyForm = { requestedDate: '', officeId: '' };
const emptyQuestion = () => ({ question: '', options: ['', '', ''], correctIndex: 0 });

function timeLabel(t) { return t ? String(t).slice(0, 5) : '—'; }

/**
 * Driving theory test booking.
 *
 * Migration 068 rebuild: the Theory test is now a real multiple-choice exam the system marks
 * itself — "this test must be multiple choice so that system can mark and automated the
 * process ... system must record the result and tell if citizen pass or fail". A citizen can
 * only book the sitting (auto-scheduled immediately); an officer sets the sitting's TIME and
 * authors ONE shared question set for everyone writing that day at their office ("same questions
 * do not write questions for specific every citizen"), then PUBLISHES it, which notifies every
 * citizen booked for that date and opens the test for them to take ("officer publish it, test
 * all citizen who supposed to write must receive notification and open for them to take test").
 * The citizen then answers the questions in this same page and the system grades it instantly.
 *
 * Migration 069 (Batch 20) made three further changes, all from the same follow-up message:
 *   - "we learner permit and driving theory test which make the same work that is repetition" —
 *     the separate "Learner Permit" hub tile/page is gone; its read-only status view now lives
 *     as a section of THIS page instead (LearnerPermitCard / IssuedPermitsPanel below), since a
 *     Learner's Permit is produced entirely by passing these two tests and was never something a
 *     citizen applied for on its own.
 *   - "it should be following day after theory test" — the auto-created Practical booking's
 *     suggested date is now the very next day (was three days).
 *   - "the system before it schedule it should aske officer the location ... and the time they
 *     will start" — that Practical booking lands as 'Requested' (see the "Schedule practical
 *     test" action below) rather than jumping straight to 'Scheduled'.
 *   - "the system must allow officer to postpone test" — a Postpone action was added for a
 *     Scheduled Practical booking and, inside TheorySessionsPanel, for a Published Theory
 *     session.
 *
 * This all still lives entirely inside the one existing "Driving Theory / Practical Test"
 * service/page — no new hub tile or separate service — per the original instruction not to
 * duplicate the theory test service, now extended to the Learner Permit tile too.
 */
export default function DrivingTestBookings() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['traffic_officer', 'system_administrator'].includes(user.roleKey);
  return isOfficer ? <OfficerQueue t={t} /> : <CitizenView t={t} />;
}

/** The citizen-facing half of what used to be the separate "Learner Permit" page (see the
 *  header comment above) — read-only, since a permit is never applied for directly. */
function LearnerPermitCard({ t }) {
  const [records, setRecords] = useState(null);
  useEffect(() => {
    api.get('/traffic/').then((d) => setRecords((d.records || []).filter((r) => r.service_type === 'Learner Permit'))).catch(() => setRecords([]));
  }, []);
  if (!records) return null;

  const today = new Date().toISOString().slice(0, 10);
  const current = [...records].sort((a, b) => new Date(b.expiry_date || 0) - new Date(a.expiry_date || 0))[0] || null;
  const isExpired = current && current.expiry_date && String(current.expiry_date).slice(0, 10) < today;

  return (
    <div className="card mb-8">
      <h2 className="mb-1 text-lg font-semibold text-slate-900">{t('traffic.learnerPermitStatus.sectionTitle')}</h2>
      {!current ? (
        <p className="text-sm text-slate-600">{t('traffic.learnerPermitStatus.noneYet')}</p>
      ) : (
        <>
          <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">
            {isExpired ? t('traffic.learnerPermitStatus.expiredBadge') : t('traffic.learnerPermitStatus.approvedBadge')}
          </p>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><dt className="text-xs text-slate-500">{t('traffic.licenceNumber')}</dt><dd className="font-mono font-medium">{current.licence_number}</dd></div>
            <div><dt className="text-xs text-slate-500">{t('traffic.drivingLicence.learnerPermitBox.issued')}</dt><dd className="font-medium">{formatDateOnly(current.issue_date)}</dd></div>
            <div>
              <dt className="text-xs text-slate-500">{t('traffic.drivingLicence.learnerPermitBox.expiry')}</dt>
              <dd className={`font-medium ${isExpired ? 'text-gov-red' : 'text-gov-green'}`}>{formatDateOnly(current.expiry_date)}</dd>
            </div>
          </dl>
          {!isExpired && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-gov-amber">⚠ {t('traffic.drivingLicence.learnerPermitBox.surrenderNotice')}</p>
          )}
        </>
      )}
    </div>
  );
}

/** The officer-facing half of what used to be the separate "Learner Permit" page — every permit
 *  issued, read-only, with nothing to action (see LearnerPermitCard above for the citizen side
 *  and the header comment for why this moved here). */
function IssuedPermitsPanel({ t }) {
  const [records, setRecords] = useState(null);
  useEffect(() => {
    api.get('/traffic/').then((d) => setRecords((d.records || []).filter((r) => r.service_type === 'Learner Permit'))).catch(() => setRecords([]));
  }, []);
  if (!records) return null;
  return (
    <div className="card mt-8">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{t('traffic.learnerPermitStatus.officerSectionTitle')}</h2>
      <DataTable
        rowKey="traffic_record_id"
        rows={records}
        emptyTitle={t('common.noResults')}
        columns={[
          { key: 'reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.application_reference}</span> },
          { key: 'citizen', header: t('common.citizen'), render: (r) => `${r.first_name} ${r.last_name}` },
          { key: 'licenceNumber', header: t('traffic.licenceNumber'), render: (r) => <span className="font-mono text-xs">{r.licence_number}</span> },
          { key: 'issueDate', header: t('traffic.drivingLicence.learnerPermitBox.issued'), render: (r) => formatDateOnly(r.issue_date) },
          { key: 'expiryDate', header: t('traffic.drivingLicence.learnerPermitBox.expiry'), render: (r) => formatDateOnly(r.expiry_date) },
        ]}
      />
    </div>
  );
}

function CitizenView({ t }) {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [testTarget, setTestTarget] = useState(null); // booking row being taken

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

      <LearnerPermitCard t={t} />

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
            {
              key: 'timeOrLocation', header: t('traffic.testBookingsForm.field.location'),
              render: (r) => {
                if (r.test_type !== 'Practical') return timeLabel(r.theory_test_time);
                if (!r.test_location) return <span className="text-slate-500">{t('traffic.testBookingsForm.awaitingSchedule')}</span>;
                return `${r.test_location}${r.scheduled_time ? ` @ ${timeLabel(r.scheduled_time)}` : ''}`;
              },
            },
            { key: 'marks', header: t('traffic.testBookingsForm.field.marks'), render: (r) => r.marks ?? '—' },
            { key: 'result', header: t('traffic.testBookingsForm.result'), render: (r) => r.result === 'Pending' ? '—' : <StatusBadge status={r.result} kind={r.result === 'Passed' ? 'positive' : 'negative'} /> },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions', header: t('common.actions'),
              render: (r) => {
                if (r.test_type === 'Theory' && r.status === 'Scheduled') {
                  if (r.submitted_at) return null;
                  if (r.theory_session_id) {
                    return <button type="button" className="btn-primary !whitespace-nowrap !px-3 !py-1.5 !text-xs" onClick={() => setTestTarget(r)}>{t('traffic.theoryTest.takeTest')}</button>;
                  }
                  return <span className="text-xs text-slate-500">{t('traffic.theoryTest.awaitingPublish')}</span>;
                }
                if (['Requested', 'Scheduled'].includes(r.status)) {
                  return <button type="button" disabled={busy} className="text-xs font-semibold text-gov-red underline" onClick={() => onCancel(r.driving_test_booking_id)}>{t('common.cancel')}</button>;
                }
                return null;
              },
            },
          ]}
        />
      )}

      <TakeTestModal booking={testTarget} onClose={() => setTestTarget(null)} onDone={() => { setTestTarget(null); load(); }} t={t} />
    </div>
  );
}

function TakeTestModal({ booking, onClose, onDone, t }) {
  const [test, setTest] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    setTest(null); setAnswers([]); setError(''); setOutcome(null);
    if (!booking) return;
    api.get(`${API_BASE}/${booking.driving_test_booking_id}/theory-test`)
      .then((d) => { setTest(d); setAnswers(new Array(d.questions.length).fill(null)); })
      .catch((err) => setError(err.message || t('common.somethingWentWrong')));
  }, [booking]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!booking) return;
    setError(''); setBusy(true);
    try {
      const result = await api.post(`${API_BASE}/${booking.driving_test_booking_id}/submit-answers`, { answers });
      setOutcome(result);
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  const allAnswered = test && answers.length === test.questions.length && answers.every((a) => a !== null);

  return (
    <Modal
      open={!!booking} onClose={outcome ? onDone : onClose} title={t('traffic.theoryTest.title')}
      footer={outcome ? (
        <button type="button" className="btn-primary" onClick={onDone}>{t('common.close')}</button>
      ) : (
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" form="theory-test-form" disabled={busy || !allAnswered} className="btn-primary">{busy ? t('common.loading') : t('traffic.theoryTest.submit')}</button>
        </>
      )}
    >
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {outcome ? (
        <p className={`rounded-md px-3 py-3 text-sm font-medium ${outcome.passed ? 'bg-green-50 text-gov-green' : 'bg-red-50 text-gov-red'}`}>
          {outcome.passed
            ? t('traffic.theoryTest.resultPassed', { score: outcome.score })
            : t('traffic.theoryTest.resultFailed', { score: outcome.score, passMark: 70 })}
        </p>
      ) : !test ? <Loading /> : (
        <form id="theory-test-form" onSubmit={onSubmit} noValidate>
          <p className="mb-4 text-sm text-slate-600">{t('traffic.theoryTest.instructions')}</p>
          {test.questions.map((q, qi) => (
            <fieldset key={qi} className="mb-5 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
              <legend className="mb-2 text-sm font-semibold text-slate-900">{qi + 1}. {q.question}</legend>
              <div className="space-y-1">
                {q.options.map((opt, oi) => (
                  <label key={oi} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio" name={`q${qi}`} checked={answers[qi] === oi}
                      onChange={() => setAnswers((a) => a.map((x, j) => (j === qi ? oi : x)))}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </form>
      )}
    </Modal>
  );
}

function OfficerQueue({ t }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(null);
  const [reasonTarget, setReasonTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [scheduleLocation, setScheduleLocation] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [postponeTarget, setPostponeTarget] = useState(null);
  const [postponeDate, setPostponeDate] = useState('');
  const [postponeTime, setPostponeTime] = useState('');
  const [postponeReason, setPostponeReason] = useState('');
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

  function openSchedule(r) {
    setScheduleTarget(r.driving_test_booking_id);
    setScheduleLocation(''); setScheduleTime('');
    setScheduleDate(String(r.requested_date).slice(0, 10));
  }

  async function onScheduleSubmit(e) {
    e.preventDefault();
    if (!scheduleTarget || !scheduleLocation.trim() || !scheduleTime) return;
    await act(scheduleTarget, 'schedule-practical', { testLocation: scheduleLocation.trim(), scheduledTime: scheduleTime, confirmedDate: scheduleDate || undefined });
    setScheduleTarget(null); setScheduleLocation(''); setScheduleTime(''); setScheduleDate('');
  }

  function openPostpone(r) {
    setPostponeTarget(r.driving_test_booking_id);
    setPostponeDate(String(r.confirmed_date || r.requested_date).slice(0, 10));
    setPostponeTime(r.scheduled_time ? String(r.scheduled_time).slice(0, 5) : '');
    setPostponeReason('');
  }

  async function onPostponeSubmit(e) {
    e.preventDefault();
    if (!postponeTarget || !postponeDate || !postponeReason.trim()) return;
    await act(postponeTarget, 'postpone', { newDate: postponeDate, newTime: postponeTime || undefined, reason: postponeReason.trim() });
    setPostponeTarget(null); setPostponeDate(''); setPostponeTime(''); setPostponeReason('');
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

      <TheorySessionsPanel t={t} onChanged={load} />

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-900">{t('traffic.testBookings')}</h2>
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
            {
              key: 'location', header: t('traffic.testBookingsForm.field.location'),
              render: (r) => r.test_location ? `${r.test_location}${r.scheduled_time ? ` @ ${timeLabel(r.scheduled_time)}` : ''}` : '—',
            },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'actions', header: t('common.actions'),
              render: (r) => {
                const rowBusy = busy === r.driving_test_booking_id;
                if (r.status === 'Requested') {
                  // Theory always auto-schedules at creation, so 'Requested' only happens for an
                  // auto-created Practical booking still awaiting an officer's date/time/venue —
                  // "the system before it schedule it should aske officer the location ... and
                  // the time they will start."
                  return (
                    <div className="flex flex-wrap gap-2">
                      {r.test_type === 'Practical' && (
                        <button type="button" disabled={rowBusy} className="btn-primary !whitespace-nowrap !px-3 !py-1.5 !text-xs" onClick={() => openSchedule(r)}>
                          {t('traffic.testBookingsForm.schedulePractical')}
                        </button>
                      )}
                      <button type="button" disabled={rowBusy} className="text-xs font-semibold text-gov-red underline" onClick={() => setReasonTarget(r.driving_test_booking_id)}>{t('common.reject')}</button>
                    </div>
                  );
                }
                if (r.status !== 'Scheduled') return null;
                if (r.test_type === 'Theory') {
                  // Self-service — see the Theory Test Sessions panel above, which also carries
                  // its own Postpone action. Nothing for an officer to do per-booking any more,
                  // other than reject it if needed.
                  const info = !r.theory_session_id
                    ? t('traffic.theorySessions.bookingAwaitingSession')
                    : r.submitted_at
                      ? t('traffic.theorySessions.bookingGraded')
                      : t('traffic.theorySessions.bookingOpen');
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-500">{info}</span>
                      <button type="button" disabled={rowBusy} className="text-xs font-semibold text-gov-red underline" onClick={() => setReasonTarget(r.driving_test_booking_id)}>{t('common.reject')}</button>
                    </div>
                  );
                }
                // Practical, Scheduled: by now a venue + time were already set at the
                // scheduling step above, so there's nothing left to fill in — just record the
                // result, postpone it (bad weather, etc.), or reject it.
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={rowBusy} className="btn-primary !whitespace-nowrap !px-3 !py-1.5 !text-xs" onClick={() => { setResultTarget(r.driving_test_booking_id); setResultValue('Passed'); setMarksValue(''); }}>
                      {t('traffic.testBookingsForm.recordResult')}
                    </button>
                    <button type="button" disabled={rowBusy} className="text-xs font-semibold text-gov-navy underline" onClick={() => openPostpone(r)}>{t('traffic.testBookingsForm.postpone')}</button>
                    <button type="button" disabled={rowBusy} className="text-xs font-semibold text-gov-red underline" onClick={() => setReasonTarget(r.driving_test_booking_id)}>{t('common.reject')}</button>
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <IssuedPermitsPanel t={t} />

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

      <Modal open={!!scheduleTarget} onClose={() => setScheduleTarget(null)} title={t('traffic.testBookingsForm.schedulePractical')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setScheduleTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="schedule-form" disabled={!scheduleLocation.trim() || !scheduleTime || !scheduleDate} className="btn-primary">{t('common.confirm')}</button>
        </>}
      >
        <form id="schedule-form" onSubmit={onScheduleSubmit} noValidate>
          <p className="mb-4 text-sm text-slate-600">{t('traffic.testBookingsForm.schedulePracticalIntro')}</p>
          <FormField label={t('traffic.testBookingsForm.field.confirmedDate')} htmlFor="scheduleDate" required>
            <input id="scheduleDate" type="date" min={new Date().toISOString().slice(0, 10)} required className="form-input" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
          </FormField>
          <FormField label={t('traffic.testBookingsForm.field.time')} htmlFor="scheduleTime" required>
            <input id="scheduleTime" type="time" required className="form-input" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
          </FormField>
          <FormField label={t('traffic.testBookingsForm.field.location')} htmlFor="scheduleLocation" required>
            <input id="scheduleLocation" type="text" required className="form-input" value={scheduleLocation} onChange={(e) => setScheduleLocation(e.target.value)} />
          </FormField>
        </form>
      </Modal>

      <Modal open={!!postponeTarget} onClose={() => setPostponeTarget(null)} title={t('traffic.testBookingsForm.postpone')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setPostponeTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="postpone-form" disabled={!postponeDate || !postponeReason.trim()} className="btn-primary">{t('common.confirm')}</button>
        </>}
      >
        <form id="postpone-form" onSubmit={onPostponeSubmit} noValidate>
          <p className="mb-4 text-sm text-slate-600">{t('traffic.testBookingsForm.postponeIntro')}</p>
          <FormField label={t('traffic.testBookingsForm.field.newDate')} htmlFor="postponeDate" required>
            <input id="postponeDate" type="date" min={new Date().toISOString().slice(0, 10)} required className="form-input" value={postponeDate} onChange={(e) => setPostponeDate(e.target.value)} />
          </FormField>
          <FormField label={t('traffic.testBookingsForm.field.newTime')} htmlFor="postponeTime" help={t('common.optional')}>
            <input id="postponeTime" type="time" className="form-input" value={postponeTime} onChange={(e) => setPostponeTime(e.target.value)} />
          </FormField>
          <FormField label={t('services.reason')} htmlFor="postponeReason" required>
            <textarea id="postponeReason" required rows={2} className="form-input" value={postponeReason} onChange={(e) => setPostponeReason(e.target.value)} />
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

/** The officer's theory-test-session manager — lives on this same page (not a separate
 *  service/tile), per "please remove duplicate service ... do not duplicate". One session per
 *  office per day: set a time and one shared multiple-choice question set, save it as a draft,
 *  then Publish when ready. */
function TheorySessionsPanel({ t, onChanged }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorIsNew, setEditorIsNew] = useState(true);
  const [testDate, setTestDate] = useState('');
  const [testTime, setTestTime] = useState('');
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [postponeTarget, setPostponeTarget] = useState(null);
  const [postponeDate, setPostponeDate] = useState('');
  const [postponeTime, setPostponeTime] = useState('');
  const [postponeReason, setPostponeReason] = useState('');

  function load() { api.get(SESSIONS_BASE).then((d) => setSessions(d.sessions)).catch(() => setSessions([])); }
  useEffect(() => { load(); }, []);

  function openPostpone(s) {
    setPostponeTarget(s.theory_test_session_id);
    setPostponeDate(String(s.test_date).slice(0, 10));
    setPostponeTime(s.test_time ? String(s.test_time).slice(0, 5) : '');
    setPostponeReason('');
  }

  async function onPostponeSubmit(e) {
    e.preventDefault();
    if (!postponeTarget || !postponeDate || !postponeReason.trim()) return;
    setError(''); setSuccess(''); setBusy(true);
    try {
      await api.post(`${SESSIONS_BASE}/${postponeTarget}/postpone`, { newDate: postponeDate, newTime: postponeTime || undefined, reason: postponeReason.trim() });
      setSuccess(t('common.saved'));
      setPostponeTarget(null); setPostponeDate(''); setPostponeTime(''); setPostponeReason('');
      load();
      onChanged?.();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  function openNew() {
    setTestDate(''); setTestTime(''); setQuestions([emptyQuestion()]); setError(''); setEditorIsNew(true); setEditorOpen(true);
  }
  function openEdit(s) {
    setTestDate(String(s.test_date).slice(0, 10));
    setTestTime(s.test_time ? String(s.test_time).slice(0, 5) : '');
    setQuestions(s.questions && s.questions.length ? s.questions.map((q) => ({ ...q, options: [...q.options] })) : [emptyQuestion()]);
    setError(''); setEditorIsNew(false); setEditorOpen(true);
  }

  function updateQuestion(qi, patch) { setQuestions((qs) => qs.map((q, i) => (i === qi ? { ...q, ...patch } : q))); }
  function updateOption(qi, oi, value) {
    setQuestions((qs) => qs.map((q, i) => (i === qi ? { ...q, options: q.options.map((o, j) => (j === oi ? value : o)) } : q)));
  }
  function addOption(qi) { setQuestions((qs) => qs.map((q, i) => (i === qi && q.options.length < 6 ? { ...q, options: [...q.options, ''] } : q))); }
  function removeOption(qi, oi) {
    setQuestions((qs) => qs.map((q, i) => {
      if (i !== qi || q.options.length <= 2) return q;
      const options = q.options.filter((_, j) => j !== oi);
      const correctIndex = q.correctIndex >= options.length ? 0 : q.correctIndex;
      return { ...q, options, correctIndex };
    }));
  }
  function addQuestion() { setQuestions((qs) => [...qs, emptyQuestion()]); }
  function removeQuestion(qi) { setQuestions((qs) => (qs.length > 1 ? qs.filter((_, i) => i !== qi) : qs)); }

  const questionsValid = questions.length > 0 && questions.every((q) =>
    q.question.trim() && q.options.length >= 2 && q.options.every((o) => o.trim())
  );

  async function onSave(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setBusy(true);
    try {
      await api.post(SESSIONS_BASE, {
        testDate, testTime: testTime || undefined,
        questions: questions.map((q) => ({ question: q.question.trim(), options: q.options.map((o) => o.trim()), correctIndex: q.correctIndex })),
      });
      setSuccess(t('common.saved'));
      setEditorOpen(false);
      load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  async function onPublish(id) {
    setError(''); setSuccess(''); setBusy(true);
    try {
      const result = await api.post(`${SESSIONS_BASE}/${id}/publish`, {});
      setSuccess(t('traffic.theorySessions.publishedNotice', { count: result.bookingsOpened }));
      load();
      onChanged?.();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t('traffic.theorySessions.title')}</h2>
          <p className="text-sm text-slate-600">{t('traffic.theorySessions.intro')}</p>
        </div>
        <button type="button" className="btn-primary !whitespace-nowrap" onClick={openNew}>{t('traffic.theorySessions.newSession')}</button>
      </div>

      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}

      {!sessions ? <Loading /> : (
        <DataTable
          rowKey="theory_test_session_id"
          rows={sessions}
          emptyTitle={t('traffic.theorySessions.noneYet')}
          columns={[
            { key: 'date', header: t('traffic.theorySessions.date'), render: (s) => formatDateOnly(s.test_date) },
            { key: 'time', header: t('traffic.theorySessions.time'), render: (s) => timeLabel(s.test_time) },
            { key: 'questionsCount', header: t('traffic.theorySessions.questionsCount'), render: (s) => (s.questions || []).length },
            { key: 'bookings', header: t('traffic.theorySessions.bookings'), render: (s) => s.booking_count },
            { key: 'status', header: t('traffic.theorySessions.status'), render: (s) => <StatusBadge status={s.status} kind={s.status === 'Published' ? 'positive' : undefined} /> },
            {
              key: 'actions', header: t('common.actions'),
              render: (s) => s.status === 'Draft' ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} className="text-xs font-semibold text-gov-navy underline" onClick={() => openEdit(s)}>{t('common.edit')}</button>
                  <button type="button" disabled={busy} className="btn-primary !whitespace-nowrap !px-3 !py-1.5 !text-xs" onClick={() => onPublish(s.theory_test_session_id)}>{t('traffic.theorySessions.publish')}</button>
                </div>
              ) : (
                <button type="button" disabled={busy} className="text-xs font-semibold text-gov-navy underline" onClick={() => openPostpone(s)}>{t('traffic.theorySessions.postpone')}</button>
              ),
            },
          ]}
        />
      )}

      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} title={editorIsNew ? t('traffic.theorySessions.newSession') : t('traffic.theorySessions.editSession')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setEditorOpen(false)}>{t('common.cancel')}</button>
          <button type="submit" form="session-form" disabled={busy || !testDate || !testTime || !questionsValid} className="btn-primary">{busy ? t('common.loading') : t('traffic.theorySessions.save')}</button>
        </>}
      >
        <form id="session-form" onSubmit={onSave} noValidate>
          <FormField label={t('traffic.theorySessions.date')} htmlFor="sessionDate" required>
            <input id="sessionDate" type="date" min={new Date().toISOString().slice(0, 10)} required className="form-input" value={testDate} onChange={(e) => setTestDate(e.target.value)} />
          </FormField>
          <FormField label={t('traffic.theorySessions.time')} htmlFor="sessionTime" required>
            <input id="sessionTime" type="time" required className="form-input" value={testTime} onChange={(e) => setTestTime(e.target.value)} />
          </FormField>

          {questions.map((q, qi) => (
            <fieldset key={qi} className="mb-4 rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('traffic.theorySessions.question')} {qi + 1}</legend>
              <input
                type="text" className="form-input mb-2" placeholder={t('traffic.testBookingsForm.questionPlaceholder', { n: qi + 1 })}
                value={q.question} onChange={(e) => updateQuestion(qi, { question: e.target.value })}
              />
              {q.options.map((opt, oi) => (
                <div key={oi} className="mb-1 flex items-center gap-2">
                  <input type="radio" name={`correct-${qi}`} checked={q.correctIndex === oi} onChange={() => updateQuestion(qi, { correctIndex: oi })} title={t('traffic.theorySessions.correctAnswer')} />
                  <input
                    type="text" className="form-input flex-1" placeholder={t('traffic.theorySessions.optionPlaceholder', { n: oi + 1 })}
                    value={opt} onChange={(e) => updateOption(qi, oi, e.target.value)}
                  />
                  {q.options.length > 2 && (
                    <button type="button" className="text-xs font-semibold text-gov-red underline" onClick={() => removeOption(qi, oi)}>{t('common.remove')}</button>
                  )}
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between">
                {q.options.length < 6 && (
                  <button type="button" className="text-xs font-medium text-gov-navy hover:underline" onClick={() => addOption(qi)}>+ {t('traffic.theorySessions.addOption')}</button>
                )}
                {questions.length > 1 && (
                  <button type="button" className="text-xs font-semibold text-gov-red underline" onClick={() => removeQuestion(qi)}>{t('common.remove')}</button>
                )}
              </div>
            </fieldset>
          ))}
          <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={addQuestion}>+ {t('traffic.theorySessions.addQuestion')}</button>
        </form>
      </Modal>

      <Modal open={!!postponeTarget} onClose={() => setPostponeTarget(null)} title={t('traffic.theorySessions.postpone')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setPostponeTarget(null)}>{t('common.cancel')}</button>
          <button type="submit" form="session-postpone-form" disabled={busy || !postponeDate || !postponeReason.trim()} className="btn-primary">{t('common.confirm')}</button>
        </>}
      >
        <form id="session-postpone-form" onSubmit={onPostponeSubmit} noValidate>
          <p className="mb-4 text-sm text-slate-600">{t('traffic.theorySessions.postponeSessionIntro')}</p>
          <FormField label={t('traffic.testBookingsForm.field.newDate')} htmlFor="sessionPostponeDate" required>
            <input id="sessionPostponeDate" type="date" min={new Date().toISOString().slice(0, 10)} required className="form-input" value={postponeDate} onChange={(e) => setPostponeDate(e.target.value)} />
          </FormField>
          <FormField label={t('traffic.testBookingsForm.field.newTime')} htmlFor="sessionPostponeTime" help={t('common.optional')}>
            <input id="sessionPostponeTime" type="time" className="form-input" value={postponeTime} onChange={(e) => setPostponeTime(e.target.value)} />
          </FormField>
          <FormField label={t('services.reason')} htmlFor="sessionPostponeReason" required>
            <textarea id="sessionPostponeReason" required rows={2} className="form-input" value={postponeReason} onChange={(e) => setPostponeReason(e.target.value)} />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
