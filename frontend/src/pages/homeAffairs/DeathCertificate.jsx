import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import EmptyState from '../../components/ui/EmptyState';
import { formatDateOnly } from '../../utils/format';

/**
 * The actual certificate a death certificate request produces, once approved — reached from
 * DeathCertificateRequest.jsx's "View certificate" result link (see the resultFields prop
 * there), the same way BirthCertificateReissue.jsx links back to BirthCertificate.jsx. Approving
 * a death certificate request used to just flip a status with nothing to show for it — see
 * migration 049 and approveDeathCertRequest in homeAffairsServices2.controller.js for where the
 * actual certificate_number now gets minted.
 *
 * This is read-only: the review/approve/reject workflow stays on DeathCertificateRequest.jsx
 * (built on ServiceWorkflowPage), so there's nothing to act on here — just the issued document,
 * styled the same way as BirthCertificate.jsx (numbered fields, certified statement, registrar
 * signature line) since a death certificate is the same kind of vital-record document.
 */
export default function DeathCertificate() {
  const { id } = useParams();
  const { t } = useLanguage();
  const [cert, setCert] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setLoadError('');
    api.get(`/home-affairs/death-certificate-request/${id}`)
      .then((d) => setCert(d.deathCertificateRequest))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  if (cert.status !== 'Approved' || !cert.certificate_number) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon="⏳"
          title={t('homeAffairs.deathCertificateView.notReadyTitle')}
          message={t('homeAffairs.deathCertificateView.notReadyMessage')}
          action={<Link to="/home-affairs/death-certificate-request" className="btn-secondary">{t('common.back')}</Link>}
        />
      </div>
    );
  }

  const v = (value) => value || t('homeAffairs.birthCertificateView.notRecorded');
  const fields = [
    [t('homeAffairs.deathCertificateView.field.idNumber'), v(cert.deceased_permanent_identity_number)],
    [t('homeAffairs.deathCertificateView.field.name'), `${cert.deceased_first_name} ${cert.deceased_middle_name || ''}`.trim()],
    [t('homeAffairs.deathCertificateView.field.surname'), cert.deceased_last_name],
    [t('homeAffairs.deathCertificateView.field.sex'), cert.deceased_sex],
    [t('homeAffairs.deathCertificateView.field.dateOfBirth'), formatDateOnly(cert.deceased_date_of_birth)],
    [t('homeAffairs.deathCertificateView.field.dateOfDeath'), formatDateOnly(cert.date_of_death)],
    [t('homeAffairs.deathCertificateView.field.placeOfDeath'), v(cert.place_of_death)],
    [t('homeAffairs.deathCertificateView.field.deathRegistrationReference'), cert.death_registration_reference],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('homeAffairs.deathCertificateView.title')}</h1>

      <div className="mb-4 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-gov-amber">
        <span>⚠ {t('homeAffairs.deathCertificateView.demoNotice')}</span>
      </div>

      {/* The certificate itself */}
      <div className="relative overflow-hidden rounded-lg border-4 border-double border-gov-navy/60 bg-white p-6 shadow-sm sm:p-8">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="rotate-[-25deg] select-none whitespace-nowrap text-6xl font-black uppercase tracking-widest text-slate-100">DEMO</span>
        </div>

        <div className="relative flex flex-col items-center border-b border-slate-200 pb-4 text-center">
          <img
            src="/images/lesotho-flag.png"
            alt={t('homeAffairs.birthCertificateView.emblemAlt')}
            className="h-10 w-16 rounded-sm border border-gov-navy/30 object-cover"
          />
          <p className="mt-2 text-xs uppercase tracking-widest text-slate-500">{t('homeAffairs.birthCertificateView.kingdomOfLesotho')}</p>
          <p className="text-xs uppercase tracking-widest text-slate-500">{t('homeAffairs.birthCertificateView.ministry')}</p>
          <h2 className="mt-2 text-xl font-bold uppercase tracking-wide text-slate-900">{t('homeAffairs.deathCertificateView.certificateTitle')}</h2>
          <p className="mt-1 font-mono text-xs text-slate-500">{t('homeAffairs.deathCertificateView.field.entryNo')}: {cert.certificate_number}</p>
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
          {t('homeAffairs.deathCertificateView.certifiedStatement')}
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

      {/* System reference — who requested this particular copy; not part of the certificate's
          own printed fields, same convention as BirthCertificate.jsx's "parent" box below. */}
      <div className="card mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthCertificateView.systemReference')}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">{t('homeAffairs.deathCertificateView.requestedBy')}</dt>
            <dd className="font-medium">{cert.first_name} {cert.last_name} ({cert.relationship_to_deceased})</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
