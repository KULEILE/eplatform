import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import FormField from '../../components/ui/FormField';
import Modal from '../../components/ui/Modal';
import { formatDateOnly } from '../../utils/format';

const emptyForm = {
  hasExistingId: true, claimedPermanentIdentityNumber: '',
  firstName: '', middleName: '', lastName: '', dateOfBirth: '', placeOfBirth: '', sex: '',
};

/**
 * The missing front door for a provisional account: birth registration and National ID
 * applications both require a citizenId to already exist, so a self-registered citizen who
 * has no matching Home Affairs record had no way to ever become verified. Here they state
 * what they know about their own identity; a Home Affairs officer reviews it against the
 * civil register (candidate match already joined in) and either links the account to the
 * matching record or enrols them as a brand new identity.
 */
export default function IdentityVerification() {
  const { user, refresh } = useAuth();
  const { t } = useLanguage();
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  return isOfficer ? <OfficerQueue t={t} /> : <CitizenRequestForm t={t} user={user} refresh={refresh} />;
}

function CitizenRequestForm({ t, user, refresh }) {
  const [requests, setRequests] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  function load() { api.get('/identity/requests').then((d) => setRequests(d.requests)); }
  useEffect(() => { load(); }, []);

  const latest = requests?.[0];
  const hasOpenRequest = latest?.status === 'Pending';
  const isVerified = !!user.citizenId;

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!form.firstName || !form.lastName || !form.dateOfBirth || !form.sex || (form.hasExistingId && !form.claimedPermanentIdentityNumber)) {
      setError(t('common.somethingWentWrong'));
      return;
    }
    setBusy(true);
    try {
      const { request } = await api.post('/identity/requests', form);
      setSuccess(t('homeAffairs.identityVerificationForm.submitted', { reference: request.reference_number }));
      setForm(emptyForm);
      load();
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (isVerified) {
    return (
      <div>
        <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('homeAffairs.identityVerification')}</h1>
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {t('homeAffairs.identityVerificationForm.verifiedNotice')}</p>
      </div>
    );
  }

  if (!requests) return <Loading />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('homeAffairs.identityVerificationForm.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('homeAffairs.identityVerificationForm.intro')}</p>

      {hasOpenRequest && (
        <p className="mb-6 flex items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
          ℹ {t('homeAffairs.identityVerificationForm.pendingNotice', { reference: latest.reference_number })}
        </p>
      )}
      {latest?.status === 'Rejected' && (
        <div className="mb-6 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
          <p>⚠ {t('homeAffairs.identityVerificationForm.rejectedNotice', { reason: latest.rejection_reason })}</p>
          <p className="mt-1 text-xs">{t('homeAffairs.identityVerificationForm.rejectedRetry')}</p>
        </div>
      )}

      {!hasOpenRequest && (
        <form onSubmit={submit} className="card mb-8">
          {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
          {success && <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">✓ {success}</p>}

          <p className="form-label">{t('homeAffairs.identityVerificationForm.haveExistingIdQuestion')}</p>
          <div className="mb-4 flex overflow-hidden rounded-md border border-slate-300 text-sm">
            <button type="button" onClick={() => setForm((f) => ({ ...f, hasExistingId: true }))} className={`flex-1 px-3 py-2 ${form.hasExistingId ? 'bg-gov-navy text-white' : 'bg-white'}`}>
              {t('homeAffairs.identityVerificationForm.yesHaveId')}
            </button>
            <button type="button" onClick={() => setForm((f) => ({ ...f, hasExistingId: false, claimedPermanentIdentityNumber: '' }))} className={`flex-1 px-3 py-2 ${!form.hasExistingId ? 'bg-gov-navy text-white' : 'bg-white'}`}>
              {t('homeAffairs.identityVerificationForm.noNeedEnrolment')}
            </button>
          </div>

          {form.hasExistingId && (
            <FormField label={t('homeAffairs.identityVerificationForm.claimedPermanentIdentityNumber')} htmlFor="claimedId" required>
              <input id="claimedId" required className="form-input" value={form.claimedPermanentIdentityNumber} onChange={(e) => setForm((f) => ({ ...f, claimedPermanentIdentityNumber: e.target.value }))} />
            </FormField>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label={t('homeAffairs.identityVerificationForm.firstName')} htmlFor="firstName" required>
              <input id="firstName" required className="form-input" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
            </FormField>
            <FormField label={t('homeAffairs.identityVerificationForm.middleName')} htmlFor="middleName">
              <input id="middleName" className="form-input" value={form.middleName} onChange={(e) => setForm((f) => ({ ...f, middleName: e.target.value }))} />
            </FormField>
            <FormField label={t('homeAffairs.identityVerificationForm.lastName')} htmlFor="lastName" required>
              <input id="lastName" required className="form-input" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
            </FormField>
            <FormField label={t('homeAffairs.identityVerificationForm.dateOfBirth')} htmlFor="dob" required>
              <input id="dob" type="date" required className="form-input" value={form.dateOfBirth} onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))} />
            </FormField>
            <FormField label={t('homeAffairs.identityVerificationForm.placeOfBirth')} htmlFor="pob">
              <input id="pob" className="form-input" value={form.placeOfBirth} onChange={(e) => setForm((f) => ({ ...f, placeOfBirth: e.target.value }))} />
            </FormField>
            <FormField label={t('homeAffairs.identityVerificationForm.sex')} htmlFor="sex" required>
              <select id="sex" required className="form-input" value={form.sex} onChange={(e) => setForm((f) => ({ ...f, sex: e.target.value }))}>
                <option value="">—</option>
                <option value="Male">{t('homeAffairs.identityVerificationForm.male')}</option>
                <option value="Female">{t('homeAffairs.identityVerificationForm.female')}</option>
                <option value="Other">{t('homeAffairs.identityVerificationForm.other')}</option>
                <option value="Unspecified">{t('homeAffairs.identityVerificationForm.unspecified')}</option>
              </select>
            </FormField>
          </div>

          <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('homeAffairs.identityVerificationForm.submit')}</button>
        </form>
      )}

      {requests.length > 0 && (
        <DataTable
          rowKey="request_id"
          rows={requests}
          columns={[
            { key: 'reference_number', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.reference_number}</span> },
            { key: 'status', header: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            { key: 'submitted_at', header: t('common.date'), render: (r) => new Date(r.submitted_at).toLocaleDateString() },
          ]}
        />
      )}
    </div>
  );
}

function OfficerQueue({ t }) {
  const [status, setStatus] = useState('Pending');
  const [requests, setRequests] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [modal, setModal] = useState(null);
  const [reason, setReason] = useState('');
  const [rowError, setRowError] = useState({});

  function load() { api.get(`/identity/requests?status=${status}`).then((d) => setRequests(d.requests)); }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  async function verify(r, treatAsNewEnrolment = false) {
    setBusyId(r.request_id);
    setRowError((e) => ({ ...e, [r.request_id]: null }));
    try {
      await api.post(`/identity/requests/${r.request_id}/verify`, { treatAsNewEnrolment });
      load();
    } catch (err) {
      setRowError((e) => ({ ...e, [r.request_id]: err.message }));
    } finally {
      setBusyId(null);
    }
  }

  async function submitReject() {
    await api.post(`/identity/requests/${modal.request_id}/reject`, { reason });
    setModal(null);
    setReason('');
    load();
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('homeAffairs.identityVerificationQueue.title')}</h1>
      <p className="mb-5 text-sm text-slate-500">{t('homeAffairs.identityVerificationQueue.desc')}</p>

      <div className="mb-5 flex overflow-hidden rounded-md border border-slate-300 text-sm w-fit">
        {['Pending', 'Verified', 'Rejected', 'All'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s === 'All' ? '' : s)}
            className={`px-3 py-2 ${(s === 'All' ? status === '' : status === s) ? 'bg-gov-navy text-white' : 'bg-white'}`}
          >
            {t(`homeAffairs.identityVerificationQueue.filter${s}`)}
          </button>
        ))}
      </div>

      {!requests ? <Loading /> : requests.length === 0 ? (
        <p className="card text-sm text-slate-500">{t('homeAffairs.identityVerificationQueue.empty')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {requests.map((r) => {
            const hasCandidate = r.has_existing_id && r.candidate_citizen_id;
            const noMatch = r.has_existing_id && !r.candidate_citizen_id;
            // The ID number matching a citizen record is not, by itself, proof the claim is
            // genuine — only treat it as a clean match when the claimed date of birth AND name
            // also agree with what's on file for that number. Otherwise it's still a "found" a
            // record, but one the officer needs to look at twice.
            const detailsMismatch = hasCandidate && (!r.candidate_dob_matches || !r.candidate_name_matches);
            const cleanMatch = hasCandidate && !detailsMismatch;
            const busy = busyId === r.request_id;
            return (
              <div key={r.request_id} className="card">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs text-slate-400">{r.reference_number}</p>
                    <p className="text-sm text-slate-500">{t('homeAffairs.identityVerificationQueue.applicant')}: <span className="font-medium text-slate-700">{r.applicant_email}</span>{r.applicant_phone ? ` · ${r.applicant_phone}` : ''}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-md border border-slate-200 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.identityVerificationQueue.asStated')}</p>
                    <dl className="space-y-1 text-sm">
                      <div><dt className="inline text-slate-500">{t('homeAffairs.identityVerificationForm.firstName')}/{t('homeAffairs.identityVerificationForm.lastName')}: </dt><dd className="inline font-medium text-slate-900">{r.first_name} {r.middle_name || ''} {r.last_name}</dd></div>
                      <div><dt className="inline text-slate-500">{t('homeAffairs.identityVerificationForm.dateOfBirth')}: </dt><dd className="inline font-medium text-slate-900">{formatDateOnly(r.date_of_birth)}</dd></div>
                      <div><dt className="inline text-slate-500">{t('homeAffairs.identityVerificationForm.sex')}: </dt><dd className="inline font-medium text-slate-900">{r.sex}</dd></div>
                      {r.place_of_birth && <div><dt className="inline text-slate-500">{t('homeAffairs.identityVerificationForm.placeOfBirth')}: </dt><dd className="inline font-medium text-slate-900">{r.place_of_birth}</dd></div>}
                      <div><dt className="inline text-slate-500">{t('auth.permanentIdentityNumber')}: </dt><dd className="inline font-mono font-medium text-slate-900">{r.has_existing_id ? r.claimed_permanent_identity_number : '—'}</dd></div>
                    </dl>
                  </div>

                  <div className={`rounded-md border p-3 ${cleanMatch ? 'border-emerald-200 bg-emerald-50' : detailsMismatch ? 'border-amber-300 bg-amber-50' : noMatch ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('homeAffairs.identityVerificationQueue.onFile')}</p>
                    {!r.has_existing_id ? (
                      <p className="text-sm text-slate-600">{t('homeAffairs.identityVerificationQueue.noExistingId')}</p>
                    ) : hasCandidate ? (
                      <dl className="space-y-1 text-sm">
                        {cleanMatch ? (
                          <p className="mb-1 flex items-center gap-1 font-medium text-emerald-700">✓ {t('homeAffairs.identityVerificationQueue.matchFound')}</p>
                        ) : (
                          <p className="mb-1 flex items-center gap-1 font-medium text-gov-amber">⚠ {t('homeAffairs.identityVerificationQueue.detailsMismatch')}</p>
                        )}
                        <div>
                          <dt className="inline text-slate-500">{t('homeAffairs.identityVerificationForm.firstName')}/{t('homeAffairs.identityVerificationForm.lastName')}: </dt>
                          <dd className={`inline font-medium ${r.candidate_name_matches ? 'text-slate-900' : 'text-gov-amber'}`}>
                            {r.candidate_first_name} {r.candidate_middle_name || ''} {r.candidate_last_name}
                            {!r.candidate_name_matches && ' ⚠'}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-slate-500">{t('homeAffairs.identityVerificationForm.dateOfBirth')}: </dt>
                          <dd className={`inline font-medium ${r.candidate_dob_matches ? 'text-slate-900' : 'text-gov-amber'}`}>
                            {formatDateOnly(r.candidate_date_of_birth)}
                            {!r.candidate_dob_matches && ' ⚠'}
                          </dd>
                        </div>
                        <div><dt className="inline text-slate-500">{t('homeAffairs.identityVerificationForm.sex')}: </dt><dd className="inline font-medium text-slate-900">{r.candidate_sex}</dd></div>
                        {detailsMismatch && (
                          <p className="mt-2 rounded bg-white/60 px-2 py-1 text-xs text-amber-900">
                            {t('homeAffairs.identityVerificationQueue.detailsMismatchExplain')}
                          </p>
                        )}
                      </dl>
                    ) : (
                      <p className="flex items-center gap-1 text-sm font-medium text-gov-red">✕ {t('homeAffairs.identityVerificationQueue.noMatchFound')}</p>
                    )}
                  </div>
                </div>

                {rowError[r.request_id] && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {rowError[r.request_id]}</p>}

                {r.status === 'Pending' && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {hasCandidate && cleanMatch && (
                      <button type="button" disabled={busy} className="btn-primary !py-1.5" onClick={() => verify(r, false)}>
                        {busy ? t('common.loading') : t('homeAffairs.identityVerificationQueue.verifyAndLink')}
                      </button>
                    )}
                    {hasCandidate && detailsMismatch && (
                      <button type="button" disabled={busy} className="btn-secondary !py-1.5 !border-amber-400 !text-amber-800" onClick={() => verify(r, false)}>
                        {busy ? t('common.loading') : t('homeAffairs.identityVerificationQueue.verifyAndLinkAnyway')}
                      </button>
                    )}
                    {!r.has_existing_id && (
                      <button type="button" disabled={busy} className="btn-primary !py-1.5" onClick={() => verify(r, true)}>
                        {busy ? t('common.loading') : t('homeAffairs.identityVerificationQueue.verify')}
                      </button>
                    )}
                    {noMatch && (
                      <button type="button" disabled={busy} className="btn-secondary !py-1.5" onClick={() => verify(r, true)}>
                        {busy ? t('common.loading') : t('homeAffairs.identityVerificationQueue.enrolAsNew')}
                      </button>
                    )}
                    <button type="button" className="text-sm font-medium text-gov-red hover:underline" onClick={() => setModal(r)}>{t('common.reject')}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={t('common.reject')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn-danger" disabled={!reason.trim()} onClick={submitReject}>{t('common.confirm')}</button>
          </>
        }
      >
        <label htmlFor="rejectReason" className="form-label">{t('common.reason')}</label>
        <textarea id="rejectReason" className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}
