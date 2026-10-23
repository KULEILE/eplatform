import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import FormField from '../../components/ui/FormField';
import DocumentCapture from '../../components/DocumentCapture';
import BackToDepartment from '../../components/BackToDepartment';

/**
 * "Birth Certificate" section (Batch 4) — replaces the old standalone "Birth Certificate
 * Reissue" hub tile. A citizen comes here to see their own certificate and any children's
 * certificates (fed by GET /home-affairs/my-birth-certificates), and to request a reissue for
 * whichever one needs it — choosing it from this real list instead of typing a raw internal
 * birth record ID they had no way to know (the rough edge BirthCertificateReissue.jsx used to
 * flag in its own code comments).
 */
export default function BirthCertificates() {
  const { t } = useLanguage();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/home-affairs/my-birth-certificates').then(setData).catch(() => setData({ own: null, children: [] }));
  }, []);

  if (!data) return <Loading />;

  const items = [
    ...(data.own ? [{ ...data.own, kind: 'own' }] : []),
    ...data.children.map((c) => ({ ...c, kind: 'child' })),
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <BackToDepartment />
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('homeAffairs.birthCertificates')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('homeAffairs.birthCertificatesIntro')}</p>

      {items.length === 0 ? (
        <div className="card text-sm text-slate-600">
          <p className="mb-3">{t('homeAffairs.birthCertificatesEmpty')}</p>
          <div className="flex gap-3">
            <Link to="/home-affairs/birth-registration/apply" className="btn-secondary">{t('homeAffairs.birthRegistrationForm.submit')}</Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <CertificateCard key={item.birth_certificate_id} item={item} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function CertificateCard({ item, t }) {
  const [reissueOpen, setReissueOpen] = useState(false);
  const [status, setStatus] = useState(item.status);
  const name = item.kind === 'own'
    ? t('homeAffairs.birthCertificatesOwn')
    : [item.first_name, item.middle_name, item.last_name].filter(Boolean).join(' ');

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900">{name}</p>
          <p className="font-mono text-xs text-slate-500">{item.certificate_number}</p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <Link to={`/home-affairs/birth-certificate/${item.birth_certificate_id}`} className="text-sm font-medium text-gov-navy hover:underline">
          {t('common.viewDetails')}
        </Link>
        <button type="button" className="text-sm font-medium text-gov-navy hover:underline" onClick={() => setReissueOpen((v) => !v)}>
          {reissueOpen ? t('common.cancel') : t('homeAffairs.birthCertificateReissueForm.requestAction')}
        </button>
      </div>
      {reissueOpen && (
        <ReissueMiniForm
          birthRecordId={item.birth_record_id}
          t={t}
          onDone={() => { setStatus('Ready for Collection'); setReissueOpen(false); }}
        />
      )}
    </div>
  );
}

function ReissueMiniForm({ birthRecordId, t, onDone }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [proofImageReference, setProofImageReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!reason) { setError(t('homeAffairs.birthCertificateReissueForm.field.reason')); return; }
    if (!proofImageReference) { setError(t('homeAffairs.birthCertificateReissueForm.field.proofHelp')); return; }
    setBusy(true);
    try {
      const r = await api.post('/home-affairs/birth-certificate-reissue', { birthRecordId, reason, details: details || undefined, proofImageReference });
      setSuccess(t('homeAffairs.birthCertificateReissueForm.certificateReady'));
      onDone();
      void r;
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {success}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 border-t border-slate-100 pt-4" noValidate>
      <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">ℹ {t('homeAffairs.birthCertificateReissueForm.doesNotExpireNotice')}</p>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <FormField label={t('homeAffairs.birthCertificateReissueForm.field.reason')} htmlFor="reissue-reason" required>
        <select id="reissue-reason" required className="form-input" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">—</option>
          <option value="Lost">{t('homeAffairs.reissueReason.Lost')}</option>
          <option value="Damaged">{t('homeAffairs.reissueReason.Damaged')}</option>
          <option value="Never Collected">{t('homeAffairs.reissueReason.NeverCollected')}</option>
          <option value="Other">{t('homeAffairs.reissueReason.Other')}</option>
        </select>
      </FormField>
      <FormField label={t('homeAffairs.birthCertificateReissueForm.field.details')} htmlFor="reissue-details" help={t('common.optional')}>
        <textarea id="reissue-details" rows={2} className="form-input" value={details} onChange={(e) => setDetails(e.target.value)} />
      </FormField>
      <DocumentCapture
        label={t('homeAffairs.birthCertificateReissueForm.field.proof')}
        help={t('homeAffairs.birthCertificateReissueForm.field.proofHelp')}
        value={proofImageReference}
        onChange={setProofImageReference}
        required
      />
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? t('common.loading') : t('homeAffairs.birthCertificateReissueForm.requestAction')}
      </button>
    </form>
  );
}
