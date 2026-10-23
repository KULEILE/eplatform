import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import FormField from '../../components/ui/FormField';
import BackToDepartment from '../../components/BackToDepartment';
import ParentIdentityFields from '../../components/ParentIdentityFields';

/**
 * Officer-only parentage queue (Batch 4/5) — the ONE place anywhere in the birth-certificate
 * domain a Home Affairs officer gets involved. Registration, self-application, and reissue are
 * all fully automatic; this only exists because a named parent disputed being named (see
 * migration 062 and homeAffairs.controller.js's listParentageDisputes/resolveParentageDispute/
 * correctParentageDispute). A row here is one of two stages, and DisputeCard branches on which:
 *   - 'Disputed'       — still open. Dismiss (the registration stands) or Uphold (clears that
 *                         parent and flags the certificate — both the applicant and the disputing
 *                         parent are then told to visit an office).
 *   - 'Dispute Upheld'  — already cleared, waiting on the officer to enter what was actually
 *                         agreed once the applicant and the disputing parent have come in and
 *                         discussed it in person.
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
          {rows.map((row) => <DisputeCard key={`${row.birth_record_id}-${row.disputed_role}`} row={row} t={t} onDone={load} />)}
        </div>
      )}
    </div>
  );
}

function DisputeCard({ row, t, onDone }) {
  const childName = [row.child_first_name_full, row.child_last_name_full].filter(Boolean).join(' ') || `${row.child_first_name} ${row.child_last_name}`;
  const submittedByName = row.submitted_by_first_name ? `${row.submitted_by_first_name} ${row.submitted_by_last_name}` : t('homeAffairs.birthRegistrationForm.selfApplication');
  const namedParentName = row.named_parent_first_name ? `${row.named_parent_first_name} ${row.named_parent_last_name}` : '—';
  const roleLabel = t(`homeAffairs.parentConfirmations.role${row.disputed_role === 'mother' ? 'Mother' : 'Father'}`);
  const awaitingCorrection = row.confirmation_status === 'Dispute Upheld';

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">{childName}</p>
        <StatusBadge status={row.confirmation_status} />
      </div>
      <p className="font-mono text-xs text-slate-500">{row.registration_reference}</p>
      <dl className="mt-3 grid grid-cols-1 gap-1 text-sm text-slate-600 sm:grid-cols-2">
        <div><dt className="text-xs text-slate-400">{t('homeAffairs.parentageDisputesForm.registeredBy')}</dt><dd>{submittedByName}</dd></div>
        <div><dt className="text-xs text-slate-400">{t('homeAffairs.parentageDisputesForm.namedOtherParent')}</dt><dd>{awaitingCorrection ? roleLabel : `${namedParentName} (${roleLabel})`}</dd></div>
      </dl>
      {row.dispute_reason && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">⚠ {row.dispute_reason}</p>
      )}
      {awaitingCorrection ? <CorrectionForm row={row} t={t} onDone={onDone} /> : <ResolveActions row={row} t={t} onDone={onDone} />}
    </div>
  );
}

function ResolveActions({ row, t, onDone }) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function resolve(resolution) {
    setBusy(true); setError('');
    try {
      await api.post(`/home-affairs/parentage-disputes/${row.birth_record_id}/resolve`, { resolution, role: row.disputed_role, notes: notes || undefined });
      onDone();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  return (
    <>
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
    </>
  );
}

// Shown once a dispute has been Upheld — the wrong parent is already cleared off the record, so
// this is purely an officer entering what was agreed once the applicant and the disputing parent
// have come in and discussed it in person (see the notification sent when the dispute was
// upheld). Reuses the exact same ParentIdentityFields component the citizen-facing registration
// forms use, so the officer can't enter anything the backend wouldn't also accept from a citizen.
function CorrectionForm({ row, t, onDone }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState({ name: '', nationality: 'Mosotho', isCitizen: true, identityNumber: '', passportNumber: '', passportImageReference: '', declaredStatus: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post(`/home-affairs/birth-registration/${row.birth_record_id}/correct-parent`, {
        role: row.disputed_role, name: value.name, nationality: value.nationality, isCitizen: value.isCitizen,
        identityNumber: value.identityNumber, passportNumber: value.passportNumber,
        passportImageReference: value.passportImageReference, declaredStatus: value.declaredStatus || undefined,
      });
      onDone();
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <div className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
        <p>ℹ {t('homeAffairs.parentageDisputesForm.awaitingCorrectionNotice')}</p>
        <button type="button" className="btn-primary mt-3 w-full" onClick={() => setOpen(true)}>
          {t('homeAffairs.parentageDisputesForm.enterCorrectionAction')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 border-t border-slate-100 pt-4" noValidate>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <ParentIdentityFields role={row.disputed_role} idPrefix={`correct-${row.birth_record_id}`} value={value} onChange={setValue} />
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="btn-primary flex-1">
          {busy ? t('common.loading') : t('homeAffairs.parentageDisputesForm.saveCorrectionAction')}
        </button>
        <button type="button" className="btn-secondary flex-1" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}
