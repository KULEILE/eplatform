import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import Modal from '../../components/ui/Modal';
import FormField from '../../components/ui/FormField';
import HandScan from '../../components/HandScan';
import { formatDateOnly } from '../../utils/format';

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
 *  arrest record to exist (e.g. a summons). A fourth action — requesting a correction to an
 *  already-recorded sentence — was added in Batch 34; see its own doc comment below.
 *
 * Batch 34 — "Record Arrest" is now a two-step modal:
 *   Step 1 (identity): confirm who is actually being arrested before anything else is entered.
 *   If the case already names a confirmed citizen, the officer can accept that in one click; if
 *   not, or if they don't trust it, they run the exact same ID-number / name / hand-biometric
 *   verification tool the standalone Identity Verification Lookup page uses (same endpoints,
 *   same audit trail in police_records) — which displays the citizen's info and full case/
 *   arrest/sentence history before anything about the arrest itself is recorded. This also
 *   covers "case may be open with no suspect info, later the investigation reveals a suspect" —
 *   confirming a real citizen here, on a case that didn't have one yet, updates the case's own
 *   subject too (see recordArrest() in policeCase.controller.js).
 *   Step 2 (details): the original charge/custody-status/notes fields, unchanged.
 */
export default function PoliceCaseDetail() {
  const { id } = useParams();
  const { t } = useLanguage();
  const [data, setData] = useState(null); // { case, arrests, sentences }
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // 'arrest' | 'sentence' | 'status' | 'correction'
  const [busy, setBusy] = useState(false);

  const [arrestForm, setArrestForm] = useState({ charge: '', custodyStatus: CUSTODY_STATUSES[0], notes: '' });
  const [sentenceForm, setSentenceForm] = useState({ outcome: OUTCOMES[0], sentenceDetails: '', courtName: '', sentenceDate: '', arrestId: '' });
  const [statusForm, setStatusForm] = useState({ status: CASE_STATUSES[0], note: '' });
  const [correctionTarget, setCorrectionTarget] = useState(null);
  const [correctionForm, setCorrectionForm] = useState({ outcome: OUTCOMES[0], sentenceDetails: '', courtName: '', sentenceDate: '', reason: '' });

  // --- Record Arrest: identity step (Batch 34) ---------------------------------------------
  const [arrestStep, setArrestStep] = useState('identity'); // 'identity' | 'details'
  const [identityMode, setIdentityMode] = useState('existing'); // 'existing' | 'pin' | 'name' | 'hand'
  const [identityForm, setIdentityForm] = useState({ permanentIdentityNumber: '', providedName: '' });
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityError, setIdentityError] = useState('');
  const [identityResult, setIdentityResult] = useState(null); // response from /police/identity-verification
  const [fallbackName, setFallbackName] = useState(''); // used when no citizen was confirmed
  const [confirmedIdentity, setConfirmedIdentity] = useState(null); // {} | {permanentIdentityNumber} | {subjectName}
  // Hand-biometric sub-flow — same two-step shape as Police.jsx (scan -> ranked candidates -> confirm).
  const [handTemplate, setHandTemplate] = useState(null);
  const [handScanKey, setHandScanKey] = useState(0);
  const [candidates, setCandidates] = useState(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const [searching, setSearching] = useState(false);

  function load() {
    api.get(`/police/cases/${id}`).then(setData).catch((err) => setError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  function resetHandFlow() {
    setHandTemplate(null); setCandidates(null); setSelectedCandidateId(null); setHandScanKey((k) => k + 1); setSearching(false);
  }

  function openArrestModal() {
    setArrestForm({ charge: '', custodyStatus: CUSTODY_STATUSES[0], notes: '' });
    setError(''); setIdentityError(''); setIdentityResult(null); setConfirmedIdentity(null);
    setIdentityForm({ permanentIdentityNumber: '', providedName: '' }); setFallbackName('');
    resetHandFlow();
    setArrestStep('identity');
    setIdentityMode(data.case.subject_citizen_id ? 'existing' : 'pin');
    setModal('arrest');
  }
  function openSentenceModal() { setSentenceForm({ outcome: OUTCOMES[0], sentenceDetails: '', courtName: '', sentenceDate: '', arrestId: '' }); setError(''); setModal('sentence'); }
  function openStatusModal() { setStatusForm({ status: data.case.status, note: '' }); setError(''); setModal('status'); }
  function openCorrectionModal(sentence) {
    setCorrectionTarget(sentence);
    setCorrectionForm({
      outcome: sentence.outcome,
      sentenceDetails: sentence.sentence_details || '',
      courtName: sentence.court_name || '',
      sentenceDate: sentence.sentence_date ? new Date(sentence.sentence_date).toISOString().slice(0, 10) : '',
      reason: '',
    });
    setError(''); setModal('correction');
  }

  function acceptExistingSubject() {
    setConfirmedIdentity({}); // no override fields -> recordArrest keeps the case's own subject
    setArrestStep('details');
  }
  function switchToVerify() { setIdentityMode('pin'); setIdentityResult(null); setIdentityError(''); resetHandFlow(); }

  async function runIdentityLookup(e) {
    e.preventDefault();
    setIdentityError(''); setIdentityResult(null); setIdentityBusy(true);
    try {
      const payload = { purpose: `Identity check at arrest for case ${data.case.case_reference}`, caseReference: data.case.case_reference };
      if (identityMode === 'pin') payload.permanentIdentityNumber = identityForm.permanentIdentityNumber;
      else payload.providedName = identityForm.providedName;
      const r = await api.post('/police/identity-verification', payload);
      setIdentityResult(r);
      setFallbackName(identityMode === 'name' ? identityForm.providedName : '');
    } catch (err) {
      setIdentityError(err.message || t('common.somethingWentWrong'));
    } finally {
      setIdentityBusy(false);
    }
  }

  async function runHandSearch() {
    setIdentityError(''); setSearching(true);
    try {
      const r = await api.post('/police/identity-verification/biometric-search', {
        template: handTemplate, purpose: `Identity check at arrest for case ${data.case.case_reference}`, caseReference: data.case.case_reference,
      });
      setCandidates(r.candidates); setSelectedCandidateId(null);
    } catch (err) {
      setIdentityError(err.message || t('common.somethingWentWrong'));
    } finally {
      setSearching(false);
    }
  }

  async function confirmHandMatch(noMatch) {
    setIdentityError(''); setIdentityResult(null); setIdentityBusy(true);
    try {
      const chosen = !noMatch ? candidates.find((c) => c.citizenId === selectedCandidateId) : null;
      const r = await api.post('/police/identity-verification', {
        purpose: `Identity check at arrest for case ${data.case.case_reference}`, caseReference: data.case.case_reference,
        matchMethod: 'Hand Biometric', confirmedCitizenId: chosen ? chosen.citizenId : null,
        similarityScore: chosen ? chosen.similarityScore : null, noMatchConfirmed: noMatch || !chosen,
      });
      setIdentityResult(r);
      setFallbackName('');
    } catch (err) {
      setIdentityError(err.message || t('common.somethingWentWrong'));
    } finally {
      setIdentityBusy(false);
    }
  }

  function proceedToDetails() {
    if (identityResult.citizen) {
      setConfirmedIdentity({ permanentIdentityNumber: identityResult.citizen.permanentIdentityNumber });
    } else {
      setConfirmedIdentity({ subjectName: fallbackName.trim() });
    }
    setArrestStep('details');
  }

  async function submitArrest() {
    setBusy(true); setError('');
    try {
      await api.post(`/police/cases/${id}/arrests`, { ...arrestForm, ...(confirmedIdentity || {}) });
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

  async function submitCorrection() {
    setBusy(true); setError('');
    try {
      await api.post(`/police/sentences/${correctionTarget.sentence_id}/amendment-requests`, correctionForm);
      setModal(null); load();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  if (!data) return error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red">⚠ {error}</p> : <Loading />;
  const { case: c, arrests, sentences } = data;
  const canContinueIdentity = identityResult && (identityResult.citizen || fallbackName.trim());

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
              <p className="text-xs text-slate-500">
                {new Date(a.arrest_date).toLocaleString()} · {a.arresting_officer_email || '—'}
                {a.subject_name ? ` · ${t('police.cases.subject')}: ${a.subject_name}` : ''}
              </p>
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
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <StatusBadge status={s.outcome} kind={STATUS_KIND[s.outcome]} />
                {!s.pending_amendment_id && (
                  <button type="button" className="text-xs font-semibold text-gov-navy underline" onClick={() => openCorrectionModal(s)}>
                    {t('police.cases.requestCorrection')}
                  </button>
                )}
              </div>
              {s.sentence_details && <p className="text-sm font-medium text-slate-800">{s.sentence_details}</p>}
              <p className="text-xs text-slate-500">
                {s.court_name ? `${s.court_name} · ` : ''}{s.sentence_date ? new Date(s.sentence_date).toLocaleDateString() : new Date(s.created_at).toLocaleDateString()} · {s.recorded_by_email || '—'}
              </p>
              {s.pending_amendment_id && (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-gov-amber">
                  ⚠ {t('police.cases.correctionPending')} — {s.pending_amendment_reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ---------------------------------------------------------------------------------- */}
      {/* Record Arrest — two steps: identity, then charge/custody (Batch 34).                */}
      {/* ---------------------------------------------------------------------------------- */}
      <Modal
        open={modal === 'arrest'} onClose={() => setModal(null)} title={t('police.cases.recordArrest')}
        footer={arrestStep === 'details' ? (
          <>
            <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
            <button type="button" disabled={busy || !arrestForm.charge.trim()} className="btn-primary" onClick={submitArrest}>{busy ? t('common.loading') : t('police.cases.submitArrest')}</button>
          </>
        ) : (
          <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
        )}
      >
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

        {arrestStep === 'identity' ? (
          <div>
            <p className="mb-3 text-sm font-semibold text-slate-700">{t('police.cases.recordArrestIdentityTitle')}</p>
            {identityError && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {identityError}</p>}

            {identityMode === 'existing' ? (
              <div>
                <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
                  {t('police.cases.currentCaseSubject')}: <strong>{c.subject_name}</strong>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={acceptExistingSubject}>{t('police.cases.confirmSameSubject')}</button>
                  <button type="button" className="btn-secondary !py-1.5 !text-xs" onClick={switchToVerify}>{t('police.cases.verifyDifferentIdentity')}</button>
                </div>
              </div>
            ) : (
              <div>
                {!c.subject_citizen_id && (
                  <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-gov-amber">⚠ {t('police.cases.noConfirmedSubjectYet')}</p>
                )}
                <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">ℹ {t('police.auditNotice')}</p>

                <div className="mb-4 flex overflow-hidden rounded-md border border-slate-300 text-sm">
                  <button type="button" onClick={() => { setIdentityMode('pin'); setIdentityResult(null); }} className={`flex-1 px-3 py-2 ${identityMode === 'pin' ? 'bg-gov-navy text-white' : 'bg-white'}`}>{t('police.cases.identityModePin')}</button>
                  <button type="button" onClick={() => { setIdentityMode('name'); setIdentityResult(null); }} className={`flex-1 px-3 py-2 ${identityMode === 'name' ? 'bg-gov-navy text-white' : 'bg-white'}`}>{t('police.cases.identityModeName')}</button>
                  <button type="button" onClick={() => { setIdentityMode('hand'); setIdentityResult(null); resetHandFlow(); }} className={`flex-1 px-3 py-2 ${identityMode === 'hand' ? 'bg-gov-navy text-white' : 'bg-white'}`}>{t('police.cases.identityModeHand')}</button>
                </div>

                {!identityResult && identityMode === 'pin' && (
                  <form onSubmit={runIdentityLookup}>
                    <FormField label={t('police.permanentIdentityNumber')} htmlFor="arrestPin" required>
                      <input id="arrestPin" required className="form-input" value={identityForm.permanentIdentityNumber} onChange={(e) => setIdentityForm((f) => ({ ...f, permanentIdentityNumber: e.target.value }))} />
                    </FormField>
                    <button type="submit" disabled={identityBusy} className="btn-primary !py-1.5 !text-xs">{identityBusy ? t('common.loading') : t('police.cases.runIdentityCheck')}</button>
                  </form>
                )}
                {!identityResult && identityMode === 'name' && (
                  <form onSubmit={runIdentityLookup}>
                    <FormField label={t('police.providedName')} htmlFor="arrestName" required>
                      <input id="arrestName" required className="form-input" value={identityForm.providedName} onChange={(e) => setIdentityForm((f) => ({ ...f, providedName: e.target.value }))} />
                    </FormField>
                    <button type="submit" disabled={identityBusy} className="btn-primary !py-1.5 !text-xs">{identityBusy ? t('common.loading') : t('police.cases.runIdentityCheck')}</button>
                  </form>
                )}
                {!identityResult && identityMode === 'hand' && (
                  <div>
                    {!handTemplate ? (
                      <HandScan key={handScanKey} onCapture={setHandTemplate} />
                    ) : !candidates ? (
                      <div className="flex flex-col items-center gap-2 py-2">
                        <p className="text-sm text-gov-green">✓ {t('police.handScanCaptured')}</p>
                        <button type="button" disabled={searching} className="btn-primary !py-1.5 !text-xs" onClick={runHandSearch}>{searching ? t('common.loading') : t('police.runBiometricSearch')}</button>
                        <button type="button" className="text-xs font-semibold text-slate-500 underline" onClick={resetHandFlow}>{t('biometricCapture.retake')}</button>
                      </div>
                    ) : (
                      <div className="pt-2">
                        <p className="mb-2 text-sm font-semibold text-slate-700">{t('police.candidateListTitle')}</p>
                        {candidates.length === 0 ? (
                          <p className="mb-3 text-sm text-slate-500">{t('police.noCandidates')}</p>
                        ) : (
                          <ul className="mb-3 space-y-2">
                            {candidates.map((cand) => (
                              <li key={cand.citizenId} className={`flex items-center justify-between rounded-md border p-2 text-sm ${selectedCandidateId === cand.citizenId ? 'border-gov-navy bg-blue-50' : 'border-slate-200'}`}>
                                <label className="flex items-center gap-2">
                                  <input type="radio" name="arrestCandidate" checked={selectedCandidateId === cand.citizenId} onChange={() => setSelectedCandidateId(cand.citizenId)} />
                                  <span>{cand.firstName} {cand.lastName} · {formatDateOnly(cand.dateOfBirth)} · <span className="font-mono">{cand.permanentIdentityNumber}</span></span>
                                </label>
                                <span className="font-semibold text-gov-navy">{cand.similarityScore}%</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={!selectedCandidateId || identityBusy} className="btn-primary !py-1.5 !text-xs" onClick={() => confirmHandMatch(false)}>{identityBusy ? t('common.loading') : t('police.confirmMatch')}</button>
                          <button type="button" disabled={identityBusy} className="btn-secondary !py-1.5 !text-xs" onClick={() => confirmHandMatch(true)}>{t('police.noneMatch')}</button>
                          <button type="button" className="text-xs font-semibold text-slate-500 underline" onClick={resetHandFlow}>{t('biometricCapture.retake')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {identityResult && (
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-700">{t('police.verificationResult')}</p>
                      <StatusBadge status={identityResult.verificationResult} kind={identityResult.verificationResult === 'Match Found' ? 'positive' : identityResult.verificationResult === 'No Match' ? 'neutral' : 'warning'} />
                    </div>
                    {identityResult.citizen ? (
                      <dl className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div><dt className="text-xs text-slate-500">Name</dt><dd className="font-medium">{identityResult.citizen.firstName} {identityResult.citizen.lastName}</dd></div>
                        <div><dt className="text-xs text-slate-500">{t('auth.dateOfBirth')}</dt><dd className="font-medium">{formatDateOnly(identityResult.citizen.dateOfBirth)}</dd></div>
                        <div><dt className="text-xs text-slate-500">{t('auth.permanentIdentityNumber')}</dt><dd className="font-mono font-medium">{identityResult.citizen.permanentIdentityNumber}</dd></div>
                      </dl>
                    ) : (
                      <>
                        <p className="mb-2 text-sm text-slate-500">No citizen record was confirmed for this lookup.</p>
                        <FormField label={t('police.cases.fallbackNameLabel')} htmlFor="fallbackName" required help={t('police.cases.fallbackNameHelp')}>
                          <input id="fallbackName" required className="form-input" value={fallbackName} onChange={(e) => setFallbackName(e.target.value)} />
                        </FormField>
                      </>
                    )}
                    {identityResult.citizen && identityResult.caseHistory && (
                      <div className="mb-3">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('police.caseHistoryTitle')}</p>
                        {identityResult.caseHistory.cases.length === 0 && identityResult.caseHistory.arrests.length === 0 && identityResult.caseHistory.sentences.length === 0 ? (
                          <p className="text-sm text-slate-500">{t('police.noCaseHistory')}</p>
                        ) : (
                          <ul className="space-y-1.5 text-xs text-slate-700">
                            {identityResult.caseHistory.sentences.map((s) => (
                              <li key={`s-${s.sentence_id}`} className="rounded border border-slate-200 p-2">
                                <strong>{t(`status.${s.outcome}`)}</strong>{s.sentence_details ? ` — ${s.sentence_details}` : ''} ({s.case_reference})
                              </li>
                            ))}
                            {identityResult.caseHistory.arrests.map((a) => (
                              <li key={`a-${a.arrest_id}`} className="rounded border border-slate-200 p-2">
                                {t('police.cases.recordArrest')}: {a.charge} — {t(`status.${a.custody_status}`)} ({a.case_reference})
                              </li>
                            ))}
                            {identityResult.caseHistory.cases.map((cs) => (
                              <li key={`c-${cs.case_id}`} className="rounded border border-slate-200 p-2">
                                {cs.case_reference} — {t(`police.cases.caseTypeOption.${cs.case_type}`)} — {t(`status.${cs.status}`)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={!canContinueIdentity} className="btn-primary !py-1.5 !text-xs" onClick={proceedToDetails}>{t('police.cases.continueToDetails')}</button>
                      <button type="button" className="text-xs font-semibold text-slate-500 underline" onClick={() => { setIdentityResult(null); resetHandFlow(); }}>{t('biometricCapture.retake')}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            <button type="button" className="mb-3 text-xs font-semibold text-gov-navy underline" onClick={() => setArrestStep('identity')}>{t('police.cases.backToIdentity')}</button>
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
          </div>
        )}
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

      {/* Request a sentence correction (Batch 34) — this never changes police_sentences itself;
          it only creates a Pending request an administrator must approve. See
          PoliceSentenceAmendments.jsx for the approval queue. */}
      <Modal
        open={modal === 'correction'} onClose={() => setModal(null)} title={t('police.cases.correctionModalTitle')}
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setModal(null)}>{t('common.cancel')}</button>
          <button
            type="button"
            disabled={busy || !correctionForm.reason.trim() || (correctionForm.outcome === 'Convicted - Sentenced' && !correctionForm.sentenceDetails.trim())}
            className="btn-primary"
            onClick={submitCorrection}
          >
            {busy ? t('common.loading') : t('police.cases.submitCorrectionRequest')}
          </button>
        </>}
      >
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">ℹ {t('police.cases.correctionModalIntro')}</p>
        <FormField label={t('police.cases.outcome')} htmlFor="correctionOutcome">
          <select id="correctionOutcome" className="form-input" value={correctionForm.outcome} onChange={(e) => setCorrectionForm((f) => ({ ...f, outcome: e.target.value }))}>
            {OUTCOMES.map((o) => <option key={o} value={o}>{t(`status.${o}`)}</option>)}
          </select>
        </FormField>
        <FormField
          label={t('police.cases.sentenceDetails')}
          htmlFor="correctionSentenceDetails"
          help={t('police.cases.sentenceDetailsHelp')}
          required={correctionForm.outcome === 'Convicted - Sentenced'}
        >
          <textarea id="correctionSentenceDetails" rows={2} className="form-input" value={correctionForm.sentenceDetails} onChange={(e) => setCorrectionForm((f) => ({ ...f, sentenceDetails: e.target.value }))} />
        </FormField>
        <FormField label={t('police.cases.courtName')} htmlFor="correctionCourtName" help={t('common.optional')}>
          <input id="correctionCourtName" className="form-input" value={correctionForm.courtName} onChange={(e) => setCorrectionForm((f) => ({ ...f, courtName: e.target.value }))} />
        </FormField>
        <FormField label={t('police.cases.sentenceDate')} htmlFor="correctionSentenceDate" help={t('common.optional')}>
          <input id="correctionSentenceDate" type="date" className="form-input" value={correctionForm.sentenceDate} onChange={(e) => setCorrectionForm((f) => ({ ...f, sentenceDate: e.target.value }))} />
        </FormField>
        <FormField label={t('police.cases.correctionReason')} htmlFor="correctionReason" required>
          <textarea id="correctionReason" required rows={2} className="form-input" value={correctionForm.reason} onChange={(e) => setCorrectionForm((f) => ({ ...f, reason: e.target.value }))} />
        </FormField>
      </Modal>
    </div>
  );
}
