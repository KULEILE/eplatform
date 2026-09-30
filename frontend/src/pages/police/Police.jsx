import React, { useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import DataTable from '../../components/ui/DataTable';
import StatusBadge from '../../components/ui/StatusBadge';
import Loading from '../../components/ui/Loading';
import { formatDateOnly } from '../../utils/format';

export default function Police() {
  const { t } = useLanguage();
  const [mode, setMode] = useState('pin'); // 'pin' | 'name'
  const [form, setForm] = useState({ permanentIdentityNumber: '', dateOfBirth: '', providedName: '', purpose: '', caseReference: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);

  function loadHistory() { api.get('/police/identity-verification').then((d) => setHistory(d.lookups)); }
  useEffect(() => { loadHistory(); }, []);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

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
        ) : (
          <FormField label={t('police.providedName')} htmlFor="providedName" required>
            <input id="providedName" required className="form-input" value={form.providedName} onChange={(e) => update('providedName', e.target.value)} />
          </FormField>
        )}

        <FormField label={t('police.purpose')} htmlFor="purpose" required help={t('police.purposeHelp')}>
          <textarea id="purpose" required rows={2} className="form-input" value={form.purpose} onChange={(e) => update('purpose', e.target.value)} />
        </FormField>
        <FormField label={t('police.caseReference')} htmlFor="caseRef" help={t('common.optional')}>
          <input id="caseRef" className="form-input" value={form.caseReference} onChange={(e) => update('caseReference', e.target.value)} />
        </FormField>

        <button type="submit" disabled={busy} className="btn-primary">{busy ? t('common.loading') : t('police.identityLookup')}</button>
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
            { key: 'created_at', header: t('common.date'), render: (r) => new Date(r.created_at).toLocaleString() },
          ]}
        />
      )}
    </div>
  );
}
