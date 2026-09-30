import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { formatDateOnly } from '../../utils/format';

export default function PoliceClearanceCertificate() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [cert, setCert] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const isOfficer = ['police_officer', 'system_administrator'].includes(user.roleKey);

  function load() {
    setLoadError('');
    api.get(`/police/clearance/${id}/certificate`)
      .then((d) => setCert(d.clearance))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  async function readyForCollection() {
    setBusy(true);
    try { await api.post(`/police/clearance/${id}/ready-for-collection`, {}); load(); } finally { setBusy(false); }
  }
  async function collect() {
    setBusy(true);
    try { await api.post(`/police/clearance/${id}/collect`, {}); load(); } finally { setBusy(false); }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState icon="⚠" title={t('common.somethingWentWrong')} message={loadError} action={<Link to="/police/clearance" className="btn-secondary">{t('common.back')}</Link>} />
      </div>
    );
  }
  if (!cert) return <Loading />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('police.clearance.certificateTitle')}</h1>

      <div className="mb-4 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-gov-amber">
        <span>⚠ {t('homeAffairs.birthCertificateView.demoNotice')}</span>
        <StatusBadge status={cert.status} />
      </div>

      <div className="relative overflow-hidden rounded-lg border-4 border-double border-gov-navy/60 bg-white p-6 shadow-sm sm:p-8">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="rotate-[-25deg] select-none whitespace-nowrap text-6xl font-black uppercase tracking-widest text-slate-100">DEMO</span>
        </div>

        <div className="relative flex flex-col items-center border-b border-slate-200 pb-4 text-center">
          <svg viewBox="0 0 30 20" className="h-10 w-16" role="img" aria-label={t('homeAffairs.birthCertificateView.emblemAlt')}>
            <rect width="30" height="20" rx="2" fill="#ffffff" stroke="#00209f" strokeWidth="0.6" />
            <rect width="30" height="5.5" fill="#00209f" />
            <rect y="14.5" width="30" height="5.5" fill="#009543" />
            <path d="M15 7.2 L18.2 12.6 H11.8 Z" fill="#1a1a1a" />
            <rect x="14.3" y="6.2" width="1.4" height="1.4" fill="#1a1a1a" />
          </svg>
          <p className="mt-2 text-xs uppercase tracking-widest text-slate-500">{t('homeAffairs.birthCertificateView.kingdomOfLesotho')}</p>
          <p className="text-xs uppercase tracking-widest text-slate-500">{t('police.clearance.serviceName')}</p>
          <h2 className="mt-2 text-xl font-bold uppercase tracking-wide text-slate-900">{t('police.clearance.certificateTitle')}</h2>
          <p className="mt-1 font-mono text-xs text-slate-500">{t('police.clearance.certificateNo')}: {cert.certificate_number}</p>
        </div>

        <p className="relative mt-5 text-sm leading-relaxed text-slate-800">
          {t('police.clearance.certifyIntro')}
        </p>

        <dl className="relative mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <div className="border-b border-dotted border-slate-200 pb-2"><dt className="text-xs uppercase tracking-wide text-slate-500">{t('police.clearance.field.fullName')}</dt><dd className="font-medium text-slate-900">{cert.first_name} {cert.last_name}</dd></div>
          <div className="border-b border-dotted border-slate-200 pb-2"><dt className="text-xs uppercase tracking-wide text-slate-500">{t('auth.dateOfBirth')}</dt><dd className="font-medium text-slate-900">{formatDateOnly(cert.date_of_birth)}</dd></div>
          <div className="border-b border-dotted border-slate-200 pb-2"><dt className="text-xs uppercase tracking-wide text-slate-500">{t('police.clearance.field.sex')}</dt><dd className="font-medium text-slate-900">{cert.sex}</dd></div>
          <div className="border-b border-dotted border-slate-200 pb-2"><dt className="text-xs uppercase tracking-wide text-slate-500">{t('auth.permanentIdentityNumber')}</dt><dd className="font-mono font-medium text-slate-900">{cert.permanent_identity_number}</dd></div>
          <div className="border-b border-dotted border-slate-200 pb-2"><dt className="text-xs uppercase tracking-wide text-slate-500">{t('police.clearance.purpose')}</dt><dd className="font-medium text-slate-900">{t(`police.clearance.purposeOption.${cert.purpose}`)}</dd></div>
          <div className="border-b border-dotted border-slate-200 pb-2"><dt className="text-xs uppercase tracking-wide text-slate-500">{t('police.clearance.field.issueDate')}</dt><dd className="font-medium text-slate-900">{formatDateOnly(cert.issue_date)}</dd></div>
        </dl>

        <p className="relative mt-5 rounded-md bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
          {cert.clearance_result === 'Record Found' ? t('police.clearance.resultStatementFound') : t('police.clearance.resultStatementClean')}
        </p>

        <div className="relative mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="h-10 w-40 border-b border-slate-400" />
            <p className="mt-1 text-xs text-slate-500">{t('police.clearance.officerSignature')}</p>
          </div>
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-center text-[9px] uppercase leading-tight text-slate-400">
            {t('homeAffairs.birthCertificateView.stampPlaceholder')}
          </div>
        </div>
      </div>

      {cert.status !== 'Collected' && (
        <div className="card mt-4">
          {cert.status === 'Ready for Collection' && (
            <p className="mb-3 text-sm text-slate-600">
              {t('homeAffairs.birthCertificateView.collectionOffice')}: <strong>{cert.office_name || '—'}</strong>
            </p>
          )}
          {cert.status !== 'Collected' && <p className="mb-3 text-sm text-gov-amber">⚠ {t('homeAffairs.birthCertificateView.notCollectedWarning')}</p>}
          {isOfficer && (
            <div className="flex gap-3">
              {cert.status === 'Approved' && <button type="button" disabled={busy} className="btn-primary" onClick={readyForCollection}>{t('common.readyForCollection')}</button>}
              {cert.status === 'Ready for Collection' && <button type="button" disabled={busy} className="btn-primary" onClick={collect}>{t('common.collect')}</button>}
            </div>
          )}
        </div>
      )}
      {cert.status === 'Collected' && (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {t('common.status')}: {t('status.Collected')}</p>
      )}
    </div>
  );
}
