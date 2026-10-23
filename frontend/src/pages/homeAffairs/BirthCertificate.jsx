import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import SignaturePad from '../../components/SignaturePad';
import { formatDateOnly } from '../../utils/format';

/**
 * Certificate layout follows the numbered-field structure of the real Kingdom of Lesotho birth
 * certificate (Entry No., child's particulars, then father/mother, then date of registration) so
 * the generated document reads like the real thing in structure and terminology. There is no
 * informant field any more — nobody but the person it's about (or, formerly, their own
 * parent/guardian) ever submits a birth certificate application, so there is no separate
 * "informant" role left to record (see migration 059). It is still clearly marked as a demo —
 * this is a prototype, not a legal document.
 * The flag at the top uses the same downloaded image as LesothoFlag.jsx (see that file for the
 * expected path).
 */
export default function BirthCertificate() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [cert, setCert] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureReference, setSignatureReference] = useState(null);
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  function load() {
    setLoadError('');
    api.get(`/home-affairs/birth-certificate/${id}`)
      .then((d) => setCert(d.birthCertificate))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  // Collecting the physical certificate is free (verified against Lesotho's published Home
  // Affairs/gov.ls service pages — no fee is listed for birth certificate registration or
  // collection), so this is a direct status change with nothing for the officer to record.
  async function confirmReadyForCollection() {
    setBusy(true);
    try {
      await api.post(`/home-affairs/birth-certificate/${id}/ready-for-collection`, {});
      load();
    } catch (err) {
      setLoadError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }
  // Collection (Feature 3): collecting the physical certificate requires the citizen's
  // signature, captured on a pad handed to them at the counter — see SignaturePad.jsx.
  async function confirmCollect() {
    setBusy(true);
    try {
      await api.post(`/home-affairs/birth-certificate/${id}/collect`, { signatureReference });
      setSignatureModalOpen(false);
      setSignatureReference(null);
      load();
    } finally {
      setBusy(false);
    }
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
    // Field 1 on the real Kingdom of Lesotho birth certificate is the holder's ID number, shown
    // before the name — matches citizens.permanent_identity_number, generated once at the
    // birth registration's approval step (see approveBirthRegistration). Previously this value
    // was left out of the numbered certificate fields entirely and only shown in the separate
    // "system reference" box below; moved here to match the real document's layout.
    [t('homeAffairs.birthCertificateView.field.idNumber'), v(cert.permanent_identity_number)],
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
          <img
            src="/images/lesotho-flag.png"
            alt={t('homeAffairs.birthCertificateView.emblemAlt')}
            className="h-10 w-16 rounded-sm border border-gov-navy/30 object-cover"
          />
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

      {/* System reference (not part of the certificate's official fields) — the permanent ID now
          appears as Field 1 on the certificate itself (see `fields` above), matching the real
          document's layout, so this box only needs the linked parent/guardian account. */}
      <div className="card mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('homeAffairs.birthCertificateView.systemReference')}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">{t('homeAffairs.birthCertificateView.parent')}</dt>
            {/* A self-application (migration 059) has no registering parent at all — cert.parent_first_name
                comes back null for it, rather than crash into "null null". */}
            <dd className="font-medium">{cert.parent_first_name ? `${cert.parent_first_name} ${cert.parent_last_name}` : t('homeAffairs.birthRegistrationForm.selfApplication')}</dd>
          </div>
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
                <button type="button" disabled={busy} className="btn-primary" onClick={confirmReadyForCollection}>{t('common.readyForCollection')}</button>
              )}
              {cert.status === 'Ready for Collection' && (
                <button type="button" disabled={busy} className="btn-primary" onClick={() => setSignatureModalOpen(true)}>{t('common.collect')}</button>
              )}
            </div>
          )}
        </div>
      )}
      {cert.status === 'Collected' && (
        <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ Collected on {new Date(cert.collected_at).toLocaleDateString()}.</p>
      )}

      <Modal
        open={signatureModalOpen}
        onClose={() => { setSignatureModalOpen(false); setSignatureReference(null); }}
        title={t('common.collect')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => { setSignatureModalOpen(false); setSignatureReference(null); }}>{t('common.cancel')}</button>
            <button type="button" disabled={busy || !signatureReference} className="btn-primary" onClick={confirmCollect}>{t('common.confirm')}</button>
          </>
        }
      >
        <SignaturePad value={signatureReference} onChange={setSignatureReference} />
      </Modal>
    </div>
  );
}