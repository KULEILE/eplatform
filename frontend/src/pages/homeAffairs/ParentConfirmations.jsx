import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import SignaturePad from '../../components/SignaturePad';
import FormField from '../../components/ui/FormField';
import BackToDepartment from '../../components/BackToDepartment';

/**
 * "You were named as a parent" review screen (Batch 4) — reached from the Dashboard's pending-
 * confirmation banner or the notification sent when a birth registration names this citizen as
 * the other parent (see migration 061 and homeAffairs.controller.js's
 * listPendingParentConfirmations/confirmParentage/disputeParentage).
 *
 * This is deliberately NON-BLOCKING: the certificate was already issued the moment the
 * registration was approved, regardless of what happens here. Confirming just signs to verify
 * it really was them; disputing sends it to a Home Affairs officer to review — the one and only
 * point anywhere in the birth-certificate domain an officer gets involved.
 */
export default function ParentConfirmations() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);

  function load() {
    api.get('/home-affairs/birth-registration/pending-confirmations').then((d) => setRows(d.pendingConfirmations)).catch(() => setRows([]));
  }
  useEffect(() => { load(); }, []);

  if (!rows) return <Loading />;

  return (
    <div className="mx-auto max-w-xl">
      <BackToDepartment />
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('homeAffairs.parentConfirmations.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('homeAffairs.parentConfirmations.intro')}</p>
      {rows.length === 0 ? (
        <div className="card text-sm text-slate-600">{t('homeAffairs.parentConfirmations.empty')}</div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <ConfirmationCard key={row.birth_record_id} row={row} t={t} onDone={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConfirmationCard({ row, t, onDone }) {
  const [mode, setMode] = useState(null); // null | 'confirm' | 'dispute'
  const [signatureReference, setSignatureReference] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submittedByName = row.submitted_by_first_name ? `${row.submitted_by_first_name} ${row.submitted_by_last_name}` : t('homeAffairs.birthRegistrationForm.selfApplication');

  async function onConfirm() {
    if (!signatureReference) { setError(t('homeAffairs.parentConfirmations.signatureRequired')); return; }
    setBusy(true); setError('');
    try {
      await api.post(`/home-affairs/birth-registration/${row.birth_record_id}/confirm-parentage`, { signatureReference });
      onDone();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  async function onDispute(e) {
    e.preventDefault();
    if (!reason) { setError(t('homeAffairs.parentConfirmations.disputeReasonRequired')); return; }
    setBusy(true); setError('');
    try {
      await api.post(`/home-affairs/birth-registration/${row.birth_record_id}/dispute-parentage`, { reason });
      onDone();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <p className="font-semibold text-slate-900">{row.child_first_name} {row.child_last_name}</p>
      <p className="font-mono text-xs text-slate-500">{row.registration_reference}</p>
      <p className="mt-2 text-sm text-slate-600">{t('homeAffairs.parentConfirmations.registeredBy', { name: submittedByName })}</p>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

      {!mode && (
        <div className="mt-4 flex gap-3">
          <button type="button" className="btn-primary flex-1" onClick={() => setMode('confirm')}>{t('homeAffairs.parentConfirmations.confirmAction')}</button>
          <button type="button" className="btn-secondary flex-1" onClick={() => setMode('dispute')}>{t('homeAffairs.parentConfirmations.disputeAction')}</button>
        </div>
      )}

      {mode === 'confirm' && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-3 text-sm text-slate-600">{t('homeAffairs.parentConfirmations.confirmHelp')}</p>
          <SignaturePad value={signatureReference} onChange={setSignatureReference} />
          <div className="mt-3 flex gap-3">
            <button type="button" disabled={busy} className="btn-primary flex-1" onClick={onConfirm}>{busy ? t('common.loading') : t('homeAffairs.parentConfirmations.confirmAction')}</button>
            <button type="button" className="btn-secondary flex-1" onClick={() => setMode(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {mode === 'dispute' && (
        <form onSubmit={onDispute} className="mt-4 border-t border-slate-100 pt-4" noValidate>
          <FormField label={t('homeAffairs.parentConfirmations.disputeReasonLabel')} htmlFor={`dispute-reason-${row.birth_record_id}`} required>
            <textarea id={`dispute-reason-${row.birth_record_id}`} required rows={3} className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <div className="flex gap-3">
            <button type="submit" disabled={busy} className="btn-primary flex-1">{busy ? t('common.loading') : t('homeAffairs.parentConfirmations.disputeAction')}</button>
            <button type="button" className="btn-secondary flex-1" onClick={() => setMode(null)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
