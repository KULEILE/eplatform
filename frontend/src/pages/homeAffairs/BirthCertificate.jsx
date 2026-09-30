import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { formatDateOnly } from '../../utils/format';

/**
 * Certificate layout follows the numbered-field structure of the real Kingdom of Lesotho birth
 * certificate (Entry No., child's particulars, then father/mother/informant, then date of
 * registration) so the generated document reads like the real thing in structure and
 * terminology. It is still clearly marked as a demo — this is a prototype, not a legal document
 * — and the roundel below is a simplified, stylised graphic rather than a reproduction of the
 * national coat of arms (see LesothoFlag.jsx for the same convention used elsewhere).
 */
export default function BirthCertificate() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [cert, setCert] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  function load() {
    setLoadError('');
    api.get(`/home-affairs/birth-certificate/${id}`)
      .then((d) => setCert(d.birthCertificate))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  async function readyForCollection() {
    setBusy(true);
    try { await api.post(`/home-affairs/birth-certificate/${id}/ready-for-collection`, {}); load(); } finally { setBusy(false); }
  }
  async function collect() {
    setBusy(true);
    try { await api.post(`/home-affairs/birth-certificate/${id}/collect`, {}); load(); } finally { setBusy(false); }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon="⚠"
          title={t('common.somethingWentWrong')}
          message={loadError}
          action={<Link to="/home-affairs" className="btn-secondary">{t('common.back')}</Link>}
        />
      </div>
    );
  }
  if (!cert) return <Loading />;

  const v = (value) => value || t('homeAffairs.birthCertificateView.notRecorded');
  const fields = [
    [t('homeAffairs.birthCertificateView.field.name'), `${cert.first_name} ${cert.middle_name || ''}`.trim()],
    [t('homeAffairs.birthCertificateView.field.surname'), cert.last_name],
    [t('homeAffairs.birthCertificateView.field.sex'), cert.sex],
    [t('homeAffairs.birthCertificateView.field.dateOfBirth'), formatDateOnly(cert.date_of_birth)],
    [t('homeAffairs.birthCertificateView.field.placeOfBirth'), cert.place_of_birth],
    [t('homeAffairs.birthCertificateView.field.fatherName'), v(cert.father_name)],
    [t('homeAffairs.birthCertificateView.field.fatherNationality'), v(cert.father_nationality)],
    [t('homeAffairs.birthCertificateView.field.motherName'), v(cert.mother_name)],
    [t('homeAffairs.birthCertificateView.field.motherMaidenSurname'), v(cert.mother_maiden_surname)],
    [t('homeAffairs.birthCertificateView.field.motherNationality'), v(cert.mother_nationality)],
    [t('homeAffairs.birthCertificateView.field.motherResidence'), v(cert.mother_residence)],
    [t('homeAffairs.birthCertificateView.field.informant'), cert.informant_name ? `${cert.informant_name}${cert.informant_capacity ? ` (${cert.informant_capacity})` : ''}` : t('homeAffairs.birthCertificateView.notRecorded')],
    [t('homeAffairs.birthCertificateView.field.informantResidence'), v(cert.informant_residence)],
    [t('homeAffairs.birthCertificateView.field.dateOfRegistration'), cert.date_of_registration ? formatDateOnly(cert.date_of_registration) : formatDateOnly(cert.issue_date)],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('homeAffairs.birthCertificateView.title')}</h1>

      <div className="mb-4 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-gov-amber">
        <span>⚠ {t('homeAffairs.birthCertificateView.demoNotice')}</span>
        <StatusBadge status={cert.status} />
      </div>

      {/* The certificate itself */}
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
          <h2 className="mt-2 text-xl font-bold uppercase tracking-wide text-slate-900">{t('homeAffairs.birthCertificateView.certificateTitle')}</h2>
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

        <p className="relative mt-6 border-t border-slate-200 pt-4 text-xs italic text-slate-500">
          {t('homeAffairs.birthCertificateView.certifiedStatement')}
        </p>

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

      {/* System reference (not part of the certificate's official fields, but useful to the
          citizen/officer in this system: links the certificate to the permanent identity number
          used everywhere else, and to the parent account that applied). */}
      <div className="card mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthCertificateView.systemReference')}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthCertificateView.permanentId')}</dt><dd className="font-mono font-medium">{cert.permanent_identity_number}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthCertificateView.parent')}</dt><dd className="font-medium">{cert.parent_first_name} {cert.parent_last_name}</dd></div>
        </dl>
      </div>

      {cert.status !== 'Collected' && (
        <div className="card mt-4">
          {cert.status === 'Certificate Generated' && (
            <p className="mb-3 text-sm text-gov-amber">⚠ {t('homeAffairs.birthCertificateView.notCollectedWarning')}</p>
          )}
          {cert.status === 'Ready for Collection' && (
            <>
              <p className="mb-3 text-sm text-slate-600">
                {t('homeAffairs.birthCertificateView.collectionOffice')}: <strong>{cert.collection_office_name || 'Maseru Home Affairs Office'}</strong>
              </p>
              <p className="mb-3 text-sm text-gov-amber">⚠ {t('homeAffairs.birthCertificateView.notCollectedWarning')}</p>
            </>
          )}
          {isOfficer && (
            <div className="flex gap-3">
              {cert.status === 'Certificate Generated' && (
                <button type="button" disabled={busy} className="btn-primary" onClick={readyForCollection}>{t('common.readyForCollection')}</button>
              )}
              {cert.status === 'Ready for Collection' && (
                <button type="button" disabled={busy} className="btn-primary" onClick={collect}>{t('common.collect')}</button>
              )}
            </div>
          )}
        </div>
      )}
      {cert.status === 'Collected' && (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ Collected on {new Date(cert.collected_at).toLocaleDateString()}.</p>
      )}
    </div>
  );
}
