import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { formatDateOnly } from '../../utils/format';

export default function DivorceCertificate() {
  const { id } = useParams();
  const { t } = useLanguage();
  const [cert, setCert] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setLoadError('');
    api.get(`/home-affairs/divorce-certificate/${id}`)
      .then((d) => setCert(d.divorceCertificate))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }, [id]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState icon="⚠" title={t('common.somethingWentWrong')} message={loadError} action={<Link to="/home-affairs/divorce-registration" className="btn-secondary">{t('common.back')}</Link>} />
      </div>
    );
  }
  if (!cert) return <Loading />;

  const fields = [
    [t('homeAffairs.marriageForm.spouse1'), `${cert.filer_first_name} ${cert.filer_last_name}`],
    [t('homeAffairs.marriageForm.spouse2'), cert.spouse_name],
    [t('homeAffairs.divorceForm.courtName'), cert.court_name],
    [t('homeAffairs.divorceForm.courtOrderReference'), cert.court_order_reference],
    [t('homeAffairs.divorceForm.divorceOrderDate'), formatDateOnly(cert.divorce_order_date)],
    [t('homeAffairs.birthCertificateView.field.dateOfRegistration'), formatDateOnly(cert.approved_at)],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('homeAffairs.divorceForm.certificateTitle')}</h1>
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
          <p className="text-xs uppercase tracking-widest text-slate-500">{t('homeAffairs.birthCertificateView.ministry')}</p>
          <h2 className="mt-2 text-xl font-bold uppercase tracking-wide text-slate-900">{t('homeAffairs.divorceForm.certificateTitle')}</h2>
          <p className="mt-1 font-mono text-xs text-slate-500">{t('homeAffairs.birthCertificateView.field.entryNo')}: {cert.certificate_number}</p>
        </div>

        <ol className="relative mt-5 grid list-none grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {fields.map(([label, value], i) => (
            <li key={label} className="flex gap-2 border-b border-dotted border-slate-200 pb-2 text-sm">
              <span className="w-5 shrink-0 font-semibold text-slate-400">{i + 1}.</span>
              <span className="flex-1">
                <span className="block text-xs uppercase tracking-wide text-slate-500">{label}</span>
                <span className="font-medium text-slate-900">{value}</span>
              </span>
            </li>
          ))}
        </ol>

        <p className="relative mt-6 border-t border-slate-200 pt-4 text-xs italic text-slate-500">{t('homeAffairs.divorceForm.certifiedStatement')}</p>

        <div className="relative mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="h-10 w-40 border-b border-slate-400" />
            <p className="mt-1 text-xs text-slate-500">{t('homeAffairs.birthCertificateView.registrarSignature')}</p>
          </div>
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-center text-[9px] uppercase leading-tight text-slate-400">
            {t('homeAffairs.birthCertificateView.stampPlaceholder')}
          </div>
        </div>
      </div>
    </div>
  );
}
