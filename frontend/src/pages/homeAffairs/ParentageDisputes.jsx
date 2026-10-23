import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import FormField from '../../components/ui/FormField';
import BackToDepartment from '../../components/BackToDepartment';

/**
 * Officer-only dispute queue (Batch 4) — the ONE place anywhere in the birth-certificate domain
 * a Home Affairs officer gets involved. Registration, self-application, and reissue are all
 * fully automatic; this only exists because the other named parent disputed being named (see
 * migration 061 and homeAffairs.controller.js's listParentageDisputes/resolveParentageDispute).
 */
export default function ParentageDisputes() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);

  function load() {
    api.get('/home-affairs/parentage-disputes').then((d) => setRows(d.disputes)).catch(() => setRows([]));
  }
  useEffect(() => { load(); }, []);

  if (!rows) return <Loading />;

  return (
    <div className="mx-auto max-w-2xl">
      <BackToDepartment />
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('homeAffairs.parentageDisputesForm.title')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('homeAffairs.parentageDisputesForm.intro')}</p>
      {rows.length === 0 ? (
        <div className="card text-sm text-slate-600">{t('homeAffairs.parentageDisputesForm.empty')}</div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => <DisputeCard key={row.birth_record_id} row={row} t={t} onDone={load} />)}
        </div>
      )}
    </div>
  );
}

function DisputeCard({ row, t, onDone }) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const childName = [row.child_first_name_full, row.child_last_name_full].filter(Boolean).join(' ') || `${row.child_first_name} ${row.child_last_name}`;
  const submittedByName = row.submitted_by_first_name ? `${row.submitted_by_first_name} ${row.submitted_by_last_name}` : t('homeAffairs.birthRegistrationForm.selfApplication');
  const otherParentName = row.other_parent_first_name ? `${row.other_parent_first_name} ${row.other_parent_last_name}` : '—';

  async function resolve(resolution) {
    setBusy(true); setError('');
    try {
      await api.post(`/home-affairs/parentage-disputes/${row.birth_record_id}/resolve`, { resolution, notes: notes || undefined });
      onDone();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">{childName}</p>
        <StatusBadge status={row.other_parent_confirmation_status} />
      </div>
      <p className="font-mono text-xs text-slate-500">{row.registration_reference}</p>
      <dl className="mt-3 grid grid-cols-1 gap-1 text-sm text-slate-600 sm:grid-cols-2">
        <div><dt className="text-xs text-slate-400">{t('homeAffairs.parentageDisputesForm.registeredBy')}</dt><dd>{submittedByName}</dd></div>
        <div><dt className="text-xs text-slate-400">{t('homeAffairs.parentageDisputesForm.namedOtherParent')}</dt><dd>{otherParentName}</dd></div>
      </dl>
      {row.other_parent_dispute_reason && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">⚠ {row.other_parent_dispute_reason}</p>
      )}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <FormField label={t('homeAffairs.parentageDisputesForm.notesLabel')} htmlFor={`notes-${row.birth_record_id}`} help={t('common.optional')}>
        <textarea id={`notes-${row.birth_record_id}`} rows={2} className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
      <div className="flex gap-3">
        <button type="button" disabled={busy} className="btn-primary flex-1" onClick={() => resolve('Dismissed')}>
          {t('homeAffairs.parentageDisputesForm.dismissAction')}
        </button>
        <button type="button" disabled={busy} className="btn-secondary flex-1 border-gov-red text-gov-red" onClick={() => resolve('Upheld')}>
          {t('homeAffairs.parentageDisputesForm.upholdAction')}
        </button>
      </div>
    </div>
  );
}
