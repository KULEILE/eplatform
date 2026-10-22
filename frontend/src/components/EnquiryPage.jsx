import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from './ui/Loading';
import EmptyState from './ui/EmptyState';
import StatusBadge from './ui/StatusBadge';
import Modal from './ui/Modal';
import FormField from './ui/FormField';
import PhotoCapture from './PhotoCapture';
import { formatDateOnly } from '../utils/format';

const FINAL = ['Rejected', 'Completed'];

/**
 * Shared "ask a question, get an officer's written answer" page. Used by:
 *   - pages/finance/FinanceComplaint.jsx   (Finance Complaint or Enquiry)
 *   - pages/pensions/PensionEnquiry.jsx    (Pension Status Enquiry)
 *
 * Citizens submit their text (and optionally a supporting document) and see each submission
 * with its reference, status and the officer's response once given. Officers see every
 * submission of this type, can start review, respond (POST {apiBase}/:id/respond) or reject.
 *
 * props: { apiBase, idColumn, officerRoleKey, serviceType, ns (translation namespace, e.g.
 *          'finance.complaint'), textField: { name, column }, evidenceField?: { name, column } }
 */
export default function EnquiryPage({ apiBase, idColumn, officerRoleKey, serviceType, ns, textField, evidenceField }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isOfficer = user.roleKey === officerRoleKey || user.roleKey === 'system_administrator';

  const [records, setRecords] = useState(null);
  const [text, setText] = useState('');
  const [evidence, setEvidence] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { record, kind: 'respond' | 'reject' }
  const [modalText, setModalText] = useState('');
  const [modalError, setModalError] = useState('');

  function load() {
    api.get(`${apiBase}/`)
      .then((d) => setRecords(d.records.filter((r) => r.service_type === serviceType)))
      .catch((err) => { setError(err.message); setRecords([]); });
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!text.trim()) return;
    setBusy(true);
    try {
      const body = { serviceType, [textField.name]: text.trim() };
      if (evidenceField && evidence) body[evidenceField.name] = evidence;
      const res = await api.post(`${apiBase}/apply`, body);
      setSuccess(`${t('services.submitted')} ${res.referenceNumber || ''}`.trim());
      setText(''); setEvidence(null);
      load();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function startReview(record) {
    setError('');
    try {
      await api.post(`${apiBase}/${record[idColumn]}/start-review`, {});
      load();
    } catch (err) { setError(err.message); }
  }

  async function submitModal() {
    setModalError('');
    try {
      const path = `${apiBase}/${modal.record[idColumn]}/${modal.kind}`;
      await api.post(path, modal.kind === 'respond' ? { response: modalText.trim() } : { reason: modalText.trim() });
      setModal(null); setModalText('');
      load();
    } catch (err) {
      setModalError(err.message || t('common.somethingWentWrong'));
    }
  }

  if (!records) return <Loading />;

  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t(`${ns}.title`)}</h1>
      <p className="mb-6 text-sm text-slate-600">{t(`${ns}.intro`)}</p>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      {!isOfficer && (
        <form onSubmit={submit} className="card mb-8" noValidate>
          {success && <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green" role="status">✓ {success}</p>}
          <FormField label={t(`${ns}.field.${textField.name}`)} htmlFor="enquiryText" required>
            <textarea id="enquiryText" rows={5} required className="form-input" value={text} onChange={(e) => setText(e.target.value)} />
          </FormField>
          {evidenceField && (
            <PhotoCapture value={evidence} onChange={setEvidence} label={t(`${ns}.field.evidence`)} help={t('common.optional')} />
          )}
          <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>{t('common.submit')}</button>
        </form>
      )}

      {records.length === 0 ? (
        <EmptyState title={t('common.noResults')} />
      ) : (
        <div className="space-y-4">
          {records.map((r) => (
            <div key={r[idColumn]} className="card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-xs text-slate-500">{r.application_reference}</span>
                  <span className="ml-3 text-xs text-slate-500">{formatDateOnly(r.created_at)}</span>
                  {isOfficer && r.first_name && (
                    <span className="ml-3 text-sm font-medium text-slate-700">{r.first_name} {r.last_name}</span>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </div>

              <p className="whitespace-pre-wrap text-sm text-slate-800">{r[textField.column]}</p>

              {evidenceField && r[evidenceField.column] && (
                <p className="mt-2 text-sm">
                  <a href={`/uploads/${r[evidenceField.column]}`} target="_blank" rel="noreferrer" className="text-gov-navy underline">
                    {t(`${ns}.field.evidence`)}
                  </a>
                </p>
              )}

              <div className="mt-4 rounded-md bg-slate-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t(`${ns}.officerResponseLabel`)}</p>
                {r.officer_response
                  ? <p className="whitespace-pre-wrap text-sm text-slate-800">{r.officer_response}</p>
                  : r.status === 'Rejected'
                    ? <p className="text-sm text-gov-red">{t('common.reason')}: {r.rejection_reason}</p>
                    : <p className="text-sm italic text-slate-500">{t(`${ns}.noResponseYet`)}</p>}
              </div>

              {isOfficer && !FINAL.includes(r.status) && (
                <div className="mt-4 flex flex-wrap gap-3">
                  {r.status === 'Submitted' && (
                    <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => startReview(r)}>
                      {t('status.Under Review')}
                    </button>
                  )}
                  <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => { setModal({ record: r, kind: 'respond' }); setModalText(''); setModalError(''); }}>
                    {t('common.respond')}
                  </button>
                  <button type="button" className="text-sm font-medium text-gov-red hover:underline" onClick={() => { setModal({ record: r, kind: 'reject' }); setModalText(''); setModalError(''); }}>
                    {t('common.reject')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.kind === 'reject' ? t('common.reject') : t('common.respond')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
            <button type="button" className={modal?.kind === 'reject' ? 'btn-danger' : 'btn-primary'} disabled={!modalText.trim()} onClick={submitModal}>
              {t('common.confirm')}
            </button>
          </>
        }
      >
        {modalError && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {modalError}</p>}
        <label htmlFor="enquiryModalText" className="form-label">
          {modal?.kind === 'reject' ? t('common.reason') : t(`${ns}.officerResponseLabel`)}
        </label>
        <textarea id="enquiryModalText" className="form-input" rows={4} value={modalText} onChange={(e) => setModalText(e.target.value)} />
      </Modal>
    </div>
  );
}
