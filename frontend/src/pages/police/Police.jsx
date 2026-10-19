import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import Loading from '../../components/ui/Loading';
import HandScan from '../../components/HandScan';
import { formatDateOnly } from '../../utils/format';

export default function Police() {
  const { t } = useLanguage();
  const [mode, setMode] = useState('pin'); // 'pin' | 'name' | 'hand'
  const [form, setForm] = useState({ permanentIdentityNumber: '', dateOfBirth: '', providedName: '', purpose: '', caseReference: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);

  // Hand-biometric search is a two-step flow, distinct from the single-request pin/name modes:
  // 1) scan a hand and get back a RANKED list of candidates (handTemplate -> candidates), then
  // 2) the officer explicitly confirms one specific candidate, or confirms none match, which is
  // the one call that actually writes an audited police_records row (see Police.controller.js's
  // searchByHandBiometric/performLookup doc comments — never a silent auto-identification).
  const [handTemplate, setHandTemplate] = useState(null);
  const [handScanKey, setHandScanKey] = useState(0); // remount HandScan to scan again
  const [candidates, setCandidates] = useState(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const [searching, setSearching] = useState(false);

  function loadHistory() { api.get('/police/identity-verification').then((d) => setHistory(d.lookups)); }
  useEffect(() => { loadHistory(); }, []);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  function resetHandFlow() {
    setHandTemplate(null);
    setCandidates(null);
    setSelectedCandidateId(null);
    setHandScanKey((k) => k + 1);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const payload = { purpose: form.purpose, caseReference: form.caseReference };
      if (mode === 'pin') { payload.permanentIdentityNumber = form.permanentIdentityNumber; payload.dateOfBirth = form.dateOfBirth || undefined; }
      else { payload.providedName = form.providedName; }
      const r = await api.post('/police/identity-verification', payload);
      setResult(r);
      loadHistory();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function runBiometricSearch() {
    setError('');
    setSearching(true);
    try {
      const r = await api.post('/police/identity-verification/biometric-search', {
        template: handTemplate, purpose: form.purpose, caseReference: form.caseReference,
      });
      setCandidates(r.candidates);
      setSelectedCandidateId(null);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setSearching(false);
    }
  }

  async function confirmBiometricMatch(noMatch) {
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const chosen = !noMatch ? candidates.find((c) => c.citizenId === selectedCandidateId) : null;
      const r = await api.post('/police/identity-verification', {
        purpose: form.purpose, caseReference: form.caseReference, matchMethod: 'Hand Biometric',
        confirmedCitizenId: chosen ? chosen.citizenId : null,
        similarityScore: chosen ? chosen.similarityScore : null,
        noMatchConfirmed: noMatch || !chosen,
      });
      setResult(r);
      resetHandFlow();
      loadHistory();
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('police.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('police.identityLookup')}</p>

      <form onSubmit={onSubmit} className="card mb-8" noValidate>
        {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
        <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">ℹ {t('police.auditNotice')}</p>

        <div className="mb-4 flex overflow-hidden rounded-md border border-slate-300 text-sm">
          <button type="button" onClick={() => setMode('pin')} className={`flex-1 px-3 py-2 ${mode === 'pin' ? 'bg-gov-navy text-white' : 'bg-white'}`}>{t('police.permanentIdentityNumber')}</button>
          <button type="button" onClick={() => setMode('name')} className={`flex-1 px-3 py-2 ${mode === 'name' ? 'bg-gov-navy text-white' : 'bg-white'}`}>{t('police.providedName')}</button>
          <button type="button" onClick={() => { setMode('hand'); resetHandFlow(); }} className={`flex-1 px-3 py-2 ${mode === 'hand' ? 'bg-gov-navy text-white' : 'bg-white'}`}>{t('police.handBiometric')}</button>
        </div>

        {mode === 'pin' ? (
          <>
            <FormField label={t('police.permanentIdentityNumber')} htmlFor="pin" required>
              <input id="pin" required className="form-input" value={form.permanentIdentityNumber} onChange={(e) => update('permanentIdentityNumber', e.target.value)} />
            </FormField>
            <FormField label={t('auth.dateOfBirth')} htmlFor="dob" help={t('common.optional')}>
              <input id="dob" type="date" className="form-input" value={form.dateOfBirth} onChange={(e) => update('dateOfBirth', e.target.value)} />
            </FormField>
          </>
        ) : mode === 'name' ? (
          <FormField label={t('police.providedName')} htmlFor="providedName" required>
            <input id="providedName" required className="form-input" value={form.providedName} onChange={(e) => update('providedName', e.target.value)} />
          </FormField>
        ) : null}

        <FormField label={t('police.purpose')} htmlFor="purpose" required help={t('police.purposeHelp')}>
          <textarea id="purpose" required rows={2} className="form-input" value={form.purpose} onChange={(e) => update('purpose', e.target.value)} />
        </FormField>
        <FormField label={t('police.caseReference')} htmlFor="caseRef" help={t('common.optional')}>
          <input id="caseRef" className="form-input" value={form.caseReference} onChange={(e) => update('caseReference', e.target.value)} />
        </FormField>

        {mode === 'hand' ? (
          <div className="mt-2">
            {!handTemplate ? (
              <HandScan key={handScanKey} onCapture={setHandTemplate} />
            ) : !candidates ? (
              <div className="flex flex-col items-center gap-2 py-2">
                <p className="text-sm text-gov-green">✓ {t('police.handScanCaptured')}</p>
                <button type="button" disabled={searching || !form.purpose.trim()} className="btn-primary !py-1.5 !text-xs" onClick={runBiometricSearch}>
                  {searching ? t('common.loading') : t('police.runBiometricSearch')}
                </button>
                {!form.purpose.trim() && <p className="text-xs text-gov-amber">⚠ {t('police.purposeRequiredForSearch')}</p>}
                <button type="button" className="text-xs font-semibold text-slate-500 underline" onClick={resetHandFlow}>{t('biometricCapture.retake')}</button>
              </div>
            ) : (
              <div className="pt-2">
                <p className="mb-2 text-sm font-semibold text-slate-700">{t('police.candidateListTitle')}</p>
                {candidates.length === 0 ? (
                  <p className="mb-3 text-sm text-slate-500">{t('police.noCandidates')}</p>
                ) : (
                  <ul className="mb-3 space-y-2">
                    {candidates.map((c) => (
                      <li key={c.citizenId} className={`flex items-center justify-between rounded-md border p-2 text-sm ${selectedCandidateId === c.citizenId ? 'border-gov-navy bg-blue-50' : 'border-slate-200'}`}>
                        <label className="flex items-center gap-2">
                          <input type="radio" name="candidate" checked={selectedCandidateId === c.citizenId} onChange={() => setSelectedCandidateId(c.citizenId)} />
                          <span>{c.firstName} {c.lastName} · {formatDateOnly(c.dateOfBirth)} · <span className="font-mono">{c.permanentIdentityNumber}</span></span>
                        </label>
                        <span className="font-semibold text-gov-navy">{c.similarityScore}%</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!selectedCandidateId || busy} className="btn-primary !py-1.5 !text-xs" onClick={() => confirmBiometricMatch(false)}>
                    {busy ? t('common.loading') : t('police.confirmMatch')}
                  </button>
                  <button type="button" disabled={busy} className="btn-secondary !py-1.5 !text-xs" onClick={() => confirmBiometricMatch(true)}>
                    {t('police.noneMatch')}
                  </button>
                  <button type="button" className="text-xs font-semibold text-slate-500 underline" onClick={resetHandFlow}>{t('biometricCapture.retake')}</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('police.identityLookup')}</button>
        )}
      </form>

      {result && (
        <div className="card mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">{t('police.verificationResult')}</h2>
            <StatusBadge status={result.verificationResult} kind={result.verificationResult === 'Match Found' ? 'positive' : result.verificationResult === 'No Match' ? 'neutral' : 'warning'} />
          </div>
          {result.citizen ? (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Name</dt><dd className="font-medium">{result.citizen.firstName} {result.citizen.lastName}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('auth.dateOfBirth')}</dt><dd className="font-medium">{formatDateOnly(result.citizen.dateOfBirth)}</dd></div>
              <div><dt className="text-xs text-slate-500">Sex</dt><dd className="font-medium">{result.citizen.sex}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('auth.permanentIdentityNumber')}</dt><dd className="font-mono font-medium">{result.citizen.permanentIdentityNumber}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No citizen record was returned for this lookup.</p>
          )}
          {result.matchMethod === 'Hand Biometric' && (
            <p className="mt-2 text-xs text-slate-500">{t('police.matchMethod')}: {t('police.handBiometric')}</p>
          )}
          <p className="mt-3 font-mono text-xs text-slate-400">{result.lookupReference}</p>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold text-slate-900">{t('police.lookupHistory')}</h2>
      {!history ? <Loading /> : (
        <DataTable
          rowKey="police_record_id"
          rows={history}
          columns={[
            { key: 'lookup_reference', header: t('applications.reference'), render: (r) => <span className="font-mono text-xs">{r.lookup_reference}</span> },
            { key: 'name', header: 'Subject', render: (r) => r.first_name ? `${r.first_name} ${r.last_name}` : (r.provided_name || '—') },
            { key: 'purpose', header: t('police.purpose') },
            { key: 'verification_result', header: t('police.verificationResult'), render: (r) => <StatusBadge status={r.verification_result} kind={r.verification_result === 'Match Found' ? 'positive' : r.verification_result === 'No Match' ? 'neutral' : 'warning'} /> },
            { key: 'match_method', header: t('police.matchMethod'), render: (r) => r.match_method === 'Hand Biometric' ? `${t('police.handBiometric')}${r.similarity_score != null ? ` (${r.similarity_score}%)` : ''}` : t('police.manualLookup') },
            { key: 'created_at', header: t('common.date'), render: (r) => new Date(r.created_at).toLocaleString() },
          ]}
        />
      )}
    </div>
  );
}
