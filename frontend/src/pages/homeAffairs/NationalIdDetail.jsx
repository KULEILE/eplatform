import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import Loading from '../../components/ui/Loading';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { formatDateOnly } from '../../utils/format';

const NEXT = {
  'Application Submitted': { action: 'start-review', label: 'Start review' },
  'Under Review': { action: 'verify', label: 'Begin identity verification' },
  'Verification in Progress': { action: 'confirm-verification', label: 'Approve' },
  'Approved': { action: 'produce', label: 'Start card production' },
  'Card Production': { action: 'ready-for-collection', label: 'Mark ready for collection' },
  'Ready for Collection': { action: 'collect', label: 'Mark as collected' },
};

// The real card prints a nationality word (e.g. "MOSOTHO"), not the internal workflow status
// this system tracks it under — map the one to the other for display only.
const NATIONALITY_LABEL = {
  Citizen: 'Mosotho',
  Naturalised: 'Naturalised Mosotho',
  'Permanent Resident': 'Permanent Resident',
  Pending: 'Pending',
};

/**
 * Card layout follows the real Lesotho National Identity Card's field set and card-shaped
 * presentation (ID number, surname/first name, nationality, sex, date of birth, place/date of
 * issue and expiry, photo + signature panels) rather than the previous plain key-value list.
 * Kept clearly marked as a demo. The flag in the card header uses the same downloaded image as
 * LesothoFlag.jsx (see that file for the expected path).
 */
export default function NationalIdDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const isOfficer = ['home_affairs_officer', 'system_administrator'].includes(user.roleKey);

  function load() {
    setLoadError('');
    api.get(`/home-affairs/national-id/${id}`)
      .then((d) => setRecord(d.nationalIdCard))
      .catch((err) => setLoadError(err.message || t('common.somethingWentWrong')));
  }
  useEffect(() => { load(); }, [id]);

  async function runAction(action) {
    setBusy(true);
    try { await api.post(`/home-affairs/national-id/${id}/${action}`, {}); load(); } finally { setBusy(false); }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState
          icon="⚠"
          title={t('common.somethingWentWrong')}
          message={loadError}
          action={<Link to="/home-affairs" className="btn-secondary">{t('common.back')}</Link>}
        />
      </div>
    );
  }
  if (!record) return <Loading />;
  const next = isOfficer ? NEXT[record.production_status] : null;
  const isIssued = !!record.card_number && !!record.approval_date;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold text-slate-900">{t('homeAffairs.nationalIdCard')}</h1>

      <div className="mt-4 mb-2 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-gov-amber">
        <span>⚠ {t('homeAffairs.nationalIdCardView.demoNotice')}</span>
        <StatusBadge status={record.production_status} />
      </div>

      {/* The card itself */}
      <div className="relative overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="rotate-[-20deg] select-none whitespace-nowrap text-4xl font-black uppercase tracking-widest text-slate-100">DEMO</span>
        </div>
        <div className="flex items-center gap-2 bg-gov-navy px-4 py-2 text-white">
          <img
            src="/images/lesotho-flag.png"
            alt={t('homeAffairs.birthCertificateView.emblemAlt')}
            className="h-5 w-8 shrink-0 rounded-sm object-cover"
          />
          <div className="leading-tight">
            <p className="text-[10px] uppercase tracking-widest text-slate-200">{t('homeAffairs.birthCertificateView.kingdomOfLesotho')}</p>
            <p className="text-xs font-bold uppercase tracking-wide">{t('homeAffairs.nationalIdCardView.cardTitle')}</p>
          </div>
        </div>

        <div className="relative flex gap-4 p-4">
          <div className="flex shrink-0 flex-col items-center gap-2">
            {record.photo_reference ? (
              <img
                src={`/uploads/${record.photo_reference}`}
                alt={t('photoCapture.previewAlt')}
                className="h-24 w-20 rounded border border-slate-300 object-cover"
              />
            ) : (
              <div className="flex h-24 w-20 items-center justify-center rounded border border-slate-300 bg-slate-50 text-3xl text-slate-300">
                👤
              </div>
            )}
            <p className="text-center text-[9px] uppercase leading-tight text-slate-400">
              {record.photo_reference ? t('homeAffairs.nationalIdCardView.photoCaptured') : t('homeAffairs.nationalIdCardView.photoPlaceholder')}
            </p>
          </div>

          <dl className="grid flex-1 grid-cols-1 gap-x-3 gap-y-1.5 text-sm">
            <div><dt className="inline text-xs uppercase text-slate-500">{t('homeAffairs.nationalIdCardView.field.surname')}: </dt><dd className="inline font-bold text-slate-900">{record.last_name}</dd></div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('homeAffairs.nationalIdCardView.field.firstName')}: </dt><dd className="inline font-medium text-slate-900">{record.first_name} {record.middle_name || ''}</dd></div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('homeAffairs.nationalIdCardView.field.nationality')}: </dt><dd className="inline font-medium text-slate-900">{NATIONALITY_LABEL[record.citizenship_status] || record.citizenship_status}</dd></div>
            <div className="flex gap-4">
              <span><dt className="inline text-xs uppercase text-slate-500">{t('homeAffairs.nationalIdCardView.field.sex')}: </dt><dd className="inline font-medium text-slate-900">{record.sex}</dd></span>
              <span><dt className="inline text-xs uppercase text-slate-500">{t('homeAffairs.nationalIdCardView.field.dateOfBirth')}: </dt><dd className="inline font-medium text-slate-900">{formatDateOnly(record.date_of_birth)}</dd></span>
            </div>
            <div><dt className="inline text-xs uppercase text-slate-500">{t('homeAffairs.nationalIdCardView.field.placeOfIssue')}: </dt><dd className="inline font-medium text-slate-900">{record.collection_office_district || t('homeAffairs.birthCertificateView.notRecorded')}</dd></div>
            <div className="flex gap-4">
              <span><dt className="inline text-xs uppercase text-slate-500">{t('homeAffairs.nationalIdCardView.field.dateOfIssue')}: </dt><dd className="inline font-medium text-slate-900">{isIssued ? formatDateOnly(record.approval_date) : '—'}</dd></span>
              <span><dt className="inline text-xs uppercase text-slate-500">{t('homeAffairs.nationalIdCardView.field.dateOfExpiry')}: </dt><dd className="inline font-medium text-slate-900">{isIssued ? formatDateOnly(record.expiry_date) : '—'}</dd></span>
            </div>
          </dl>
        </div>

        <div className="relative flex items-center justify-between border-t border-dashed border-slate-300 px-4 py-2">
          <p className="font-mono text-xs tracking-widest text-slate-500">{t('homeAffairs.nationalIdCardView.field.idNumber')}: {record.permanent_identity_number}</p>
          <div className="h-6 w-20 border-b border-slate-400 text-center text-[8px] uppercase text-slate-400">{t('homeAffairs.nationalIdCardView.signaturePlaceholder')}</div>
        </div>
        {record.card_number && (
          <p className="relative border-t border-slate-100 px-4 py-1.5 text-right font-mono text-[10px] text-slate-400">{record.card_number}</p>
        )}
      </div>

      <div className="card mt-4">
        <p className="mb-4 text-sm text-slate-600">{t(`statusHelp.${record.production_status}`)}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">Biometric status</dt><dd><StatusBadge status={record.biometric_status} kind={record.biometric_status === 'Enrolled' ? 'positive' : 'neutral'} /></dd></div>
          {record.collection_office_name && <div><dt className="text-xs text-slate-500">{t('homeAffairs.birthCertificateView.collectionOffice')}</dt><dd className="font-medium">{record.collection_office_name}</dd></div>}
        </dl>
        {record.production_status === 'Ready for Collection' && (
          <p className="mt-4 text-sm text-gov-amber">⚠ {t('homeAffairs.birthCertificateView.notCollectedWarning')}</p>
        )}
        {next && (
          <div className="mt-6 border-t border-slate-100 pt-4">
            <button type="button" disabled={busy} className="btn-primary" onClick={() => runAction(next.action)}>{next.label}</button>
          </div>
        )}
      </div>
    </div>
  );
}