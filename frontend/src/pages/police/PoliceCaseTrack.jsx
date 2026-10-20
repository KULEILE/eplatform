import React, { useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import StatusBadge from '../../components/ui/StatusBadge';
import { formatDateOnly } from '../../utils/format';

/** Citizen-facing "Criminal case tracking" (service #10): check a case's status using its
 *  reference number. Deliberately a standalone lookup, not routed through the generic
 *  "My Applications" tracker — a case is opened by an officer against a citizen, not submitted
 *  by them, so there is nothing in their own applications list to show. Only works when the
 *  case's subject_citizen_id is the citizen doing the lookup (enforced server-side in
 *  policeCase.controller.js's trackCase) — this page never lets anyone type in someone else's
 *  reference number and see their case. */
export default function PoliceCaseTrack() {
  const { t } = useLanguage();
  const [caseReference, setCaseReference] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSearch(e) {
    e.preventDefault();
    setError(''); setResult(null);
    if (!caseReference.trim()) return;
    setBusy(true);
    try {
      const data = await api.get(`/police/cases/track?caseReference=${encodeURIComponent(caseReference.trim())}`);
      setResult(data.case);
    } catch (err) {
      setError(err.message || t('police.track.notFound'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('police.track.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('police.track.intro')}</p>

      <form onSubmit={onSearch} className="card mb-6 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[12rem]">
          <label htmlFor="caseReference" className="form-label">{t('police.track.caseReferenceLabel')}</label>
          <input
            id="caseReference" type="text" className="form-input" value={caseReference}
            onChange={(e) => setCaseReference(e.target.value)} placeholder="PCS-2026-123456"
          />
        </div>
        <button type="submit" disabled={busy || !caseReference.trim()} className="btn-primary">{t('police.track.search')}</button>
      </form>

      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      {result && (
        <div className="card">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">{t('police.track.result.reference')}</dt>
              <dd className="font-mono text-sm text-slate-900">{result.case_reference}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">{t('police.track.result.caseType')}</dt>
              <dd className="text-sm text-slate-900">{t(`police.cases.caseTypeOption.${result.case_type}`)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">{t('police.track.result.status')}</dt>
              <dd><StatusBadge status={result.status} /></dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">{t('police.track.result.openedOn')}</dt>
              <dd className="text-sm text-slate-900">{formatDateOnly(result.created_at)}</dd>
            </div>
            {result.closed_at && (
              <div>
                <dt className="text-xs font-semibold uppercase text-slate-500">{t('police.track.result.closedOn')}</dt>
                <dd className="text-sm text-slate-900">{formatDateOnly(result.closed_at)}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
