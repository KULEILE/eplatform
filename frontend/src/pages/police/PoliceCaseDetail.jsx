import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import Modal from '../../components/ui/Modal';
import FormField from '../../components/ui/FormField';

const CUSTODY_STATUSES = ['In Custody', 'Released on Bail', 'Released Without Charge', 'Transferred to Court'];
const OUTCOMES = ['Convicted - Sentenced', 'Acquitted', 'Case Dismissed', 'Caution/Diversion'];
const CASE_STATUSES = ['Open', 'Under Investigation', 'Referred to Court', 'Closed - Resolved', 'Closed - Unresolved'];

const STATUS_KIND = {
  'Open': 'warning', 'Under Investigation': 'info', 'Referred to Court': 'info',
  'Closed - Resolved': 'positive', 'Closed - Unresolved': 'neutral',
  'In Custody': 'negative', 'Released on Bail': 'warning', 'Released Without Charge': 'positive', 'Transferred to Court': 'info',
  'Convicted - Sentenced': 'negative', 'Acquitted': 'positive', 'Case Dismissed': 'neutral', 'Caution/Diversion': 'warning',
};

/** Officer-only case detail: view what's on record, then record an arrest and/or a sentence/
 *  outcome against this specific case (see policeCase.controller.js). Separate modals for each
 *  of the three actions ("start the case, arrest and the sentence") rather than one combined
 *  form — a case can accumulate more than one arrest, and a sentence doesn't require a prior
 *  arrest record to exist (e.g. a summons). */
export default function PoliceCaseDetail() {
  const { id } = useParams();
  const { t } = useLanguage();
  const [data, setData] = useState(null); // { case, arrests, sentences }
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // 'arrest' | 'sentence' | 'status'
  const [busy, setBusy] = useState(false);

  const [arrestForm, setArrestForm] = useState({ charge: '', custodyStatus: CUSTODY_STATUSES[0], notes: '' });
  const [sentenceForm, setSentenceForm] = useState({ outcome: OUTCOMES[0], sentenceDetails: '', courtName: '', sentenceDate: '', arrestId: '' });
  const [statusForm, setStatusForm] = useState({ status: CASE_STATUSES[0], note: '' });

  function load() {
    api.get(`/police/cases/${id}`).then(setData).catch((err) => setError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  function openArrestModal() { setArrestForm({ charge: '', custodyStatus: CUSTODY_STATUSES[0], notes: '' }); setError(''); setModal('arrest'); }
  function openSentenceModal() { setSentenceForm({ outcome: OUTCOMES[0], sentenceDetails: '', courtName: '', sentenceDate: '', arrestId: '' }); setError(''); setModal('sentence'); }
  function openStatusModal() { setStatusForm({ status: data.case.status, note: '' }); setError(''); setModal('status'); }

  async function submitArrest() {
    setBusy(true); setError('');
    try {
      await api.post(`/police/cases/${id}/arrests`, arrestForm);
      setModal(null); load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  async function submitSentence() {
    setBusy(true); setError('');
    try {
      await api.post(`/police/cases/${id}/sentences`, { ...sentenceForm, arrestId: sentenceForm.arrestId || null });
      setModal(null); load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  async function submitStatus() {
    setBusy(true); setError('');
    try {
      await api.patch(`/police/cases/${id}/status`, statusForm);
      setModal(null); load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  if (!data) return error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red">⚠ {error}</p> : <Loading />;
  const { case: c, arrests, sentences } = data;

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/police/cases" className="mb-4 inline-block text-sm font-medium text-gov-navy hover:underline">← {t('police.cases.backToCases')}</Link>

      <div className="card mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-mono text-lg font-bold text-slate-900">{c.case_reference}</h1>
          <StatusBadge status={c.status} kind={STATUS_KIND[c.status]} />
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">{t('police.cases.subject')}</dt><dd className="font-medium">{c.subject_name || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('police.cases.caseType')}</dt><dd className="font-medium">{t(`police.cases.caseTypeOption.${c.case_type}`)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-slate-500">{t('police.cases.offenseDescription')}</dt><dd className="font-medium">{c.offense_description}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('police.cases.openedOn')}</dt><dd className="font-medium">{new Date(c.created_at).toLocaleString()}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !py-1.5 !text-xs" onClick={openStatusModal}>{t('police.cases.changeStatus')}</button>
          <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={openArrestModal}>{t('police.cases.recordArrest')}</button>
          <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={openSentenceModal}>{t('police.cases.recordSentence')}</button>
        </div>
      </div>

      {error && !modal && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      <h2 className="mb-2 text-base font-semibold text-slate-900">{t('police.cases.arrests')}</h2>
      {arrests.length === 0 ? (
        <p className="mb-6 text-sm text-slate-500">{t('police.cases.noArrests')}</p>
      ) : (
        <ul className="mb-6 space-y-2">
          {arrests.map((a) => (
            <li key={a.arrest_id} className="card">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-500">{a.arrest_reference}</span>
                <StatusBadge status={a.custody_status} kind={STATUS_KIND[a.custody_status]} />
              </div>
              <p className="text-sm font-medium text-slate-800">{a.charge}</p>
              <p className="text-xs text-slate-500">{new Date(a.arrest_date).toLocaleString()} · {a.arresting_officer_email || '—'}</p>
              {a.notes && <p className="mt-1 text-sm text-slate-600">{a.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 text-base font-semibold text-slate-900">{t('police.cases.sentences')}</h2>
      {sentences.length === 0 ? (
        <p className="text-sm text-slate-500">{t('police.cases.noSentences')}</p>
      ) : (
        <ul className="space-y-2">
          {sentences.map((s) => (
            <li key={s.sentence_id} className="card">
              <div className="mb-1"><StatusBadge status={s.outcome} kind={STATUS_KIND[s.outcome]} /></div>
              {s.sentence_details && <p className="text-sm font-medium text-slate-800">{s.sentence_details}</p>}
              <p className="text-xs text-slate-500">
                {s.court_name ? `${s.court_name} · ` : ''}{s.sentence_date ? new Date(s.sentence_date).toLocaleDateString() : new Date(s.created_at).toLocaleDateString()} · {s.recorded_by_email || '—'}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={modal === 'arrest'} onClose={() => setModal(null)} title={t('police.cases.recordArrest')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
          <button type="button" disabled={busy || !arrestForm.charge.trim()} className="btn-primary" onClick={submitArrest}>{busy ? t('common.loading') : t('police.cases.submitArrest')}</button>
        </>}
      >
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        <FormField label={t('police.cases.charge')} htmlFor="charge" required>
          <textarea id="charge" required rows={2} className="form-input" value={arrestForm.charge} onChange={(e) => setArrestForm((f) => ({ ...f, charge: e.target.value }))} />
        </FormField>
        <FormField label={t('police.cases.custodyStatus')} htmlFor="custodyStatus">
          <select id="custodyStatus" className="form-input" value={arrestForm.custodyStatus} onChange={(e) => setArrestForm((f) => ({ ...f, custodyStatus: e.target.value }))}>
            {CUSTODY_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </select>
        </FormField>
        <FormField label={t('police.cases.arrestNotes')} htmlFor="arrestNotes" help={t('common.optional')}>
          <textarea id="arrestNotes" rows={2} className="form-input" value={arrestForm.notes} onChange={(e) => setArrestForm((f) => ({ ...f, notes: e.target.value }))} />
        </FormField>
      </Modal>

      <Modal
        open={modal === 'sentence'} onClose={() => setModal(null)} title={t('police.cases.recordSentence')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
          <button
            type="button"
            disabled={busy || (sentenceForm.outcome === 'Convicted - Sentenced' && !sentenceForm.sentenceDetails.trim())}
            className="btn-primary"
            onClick={submitSentence}
          >
            {busy ? t('common.loading') : t('police.cases.submitSentence')}
          </button>
        </>}
      >
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        <FormField label={t('police.cases.outcome')} htmlFor="outcome">
          <select id="outcome" className="form-input" value={sentenceForm.outcome} onChange={(e) => setSentenceForm((f) => ({ ...f, outcome: e.target.value }))}>
            {OUTCOMES.map((o) => <option key={o} value={o}>{t(`status.${o}`)}</option>)}
          </select>
        </FormField>
        <FormField
          label={t('police.cases.sentenceDetails')}
          htmlFor="sentenceDetails"
          help={t('police.cases.sentenceDetailsHelp')}
          required={sentenceForm.outcome === 'Convicted - Sentenced'}
        >
          <textarea id="sentenceDetails" rows={2} className="form-input" value={sentenceForm.sentenceDetails} onChange={(e) => setSentenceForm((f) => ({ ...f, sentenceDetails: e.target.value }))} />
        </FormField>
        <FormField label={t('police.cases.courtName')} htmlFor="courtName" help={t('common.optional')}>
          <input id="courtName" className="form-input" value={sentenceForm.courtName} onChange={(e) => setSentenceForm((f) => ({ ...f, courtName: e.target.value }))} />
        </FormField>
        <FormField label={t('police.cases.sentenceDate')} htmlFor="sentenceDate" help={t('common.optional')}>
          <input id="sentenceDate" type="date" className="form-input" value={sentenceForm.sentenceDate} onChange={(e) => setSentenceForm((f) => ({ ...f, sentenceDate: e.target.value }))} />
        </FormField>
        {arrests.length > 0 && (
          <FormField label={t('police.cases.linkedArrest')} htmlFor="linkedArrest">
            <select id="linkedArrest" className="form-input" value={sentenceForm.arrestId} onChange={(e) => setSentenceForm((f) => ({ ...f, arrestId: e.target.value }))}>
              <option value="">{t('police.cases.none')}</option>
              {arrests.map((a) => <option key={a.arrest_id} value={a.arrest_id}>{a.arrest_reference} — {a.charge}</option>)}
            </select>
          </FormField>
        )}
      </Modal>

      <Modal
        open={modal === 'status'} onClose={() => setModal(null)} title={t('police.cases.changeStatus')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
          <button type="button" disabled={busy} className="btn-primary" onClick={submitStatus}>{busy ? t('common.loading') : t('common.confirm')}</button>
        </>}
      >
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        <FormField label={t('police.cases.status')} htmlFor="caseStatus">
          <select id="caseStatus" className="form-input" value={statusForm.status} onChange={(e) => setStatusForm((f) => ({ ...f, status: e.target.value }))}>
            {CASE_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </select>
        </FormField>
        <FormField label={t('police.cases.statusNote')} htmlFor="statusNote" help={t('common.optional')}>
          <textarea id="statusNote" rows={2} className="form-input" value={statusForm.note} onChange={(e) => setStatusForm((f) => ({ ...f, note: e.target.value }))} />
        </FormField>
      </Modal>
    </div>
  );
}
