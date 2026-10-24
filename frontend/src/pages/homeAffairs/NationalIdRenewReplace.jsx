import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import DocumentCapture from '../../components/DocumentCapture';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';
import BackToDepartment from '../../components/BackToDepartment';
import Loading from '../../components/ui/Loading';
import { formatDateOnly } from '../../utils/format';

const emptyForm = {
  applicationType: 'Renewal', replacementReason: '', replacementDetails: '',
  replacementProofReference: '', reportedLostAt: '', preferredOfficeId: '',
};

/**
 * National ID card renewal & replacement — reuses the existing national_id_cards table and is
 * now fully automatic (biometrics are always already on file by the time a citizen has a
 * previous collected card, so there's no police-station step here — see
 * homeAffairs.controller.js's applyNationalIdRenewalReplacement).
 *
 * Rewritten for the client's enhancement:
 *  - Renewal is blocked server-side unless the current card has actually expired; this page
 *    loads GET /national-id/eligibility up front and shows the current card + its expiry BEFORE
 *    the citizen can attempt a renewal, rather than letting them submit and fail.
 *  - Replacement reasons are narrowed to Lost/Stolen/Damaged (Expired is handled via Renewal;
 *    Other was dropped) and always require a supporting document; Lost/Stolen additionally ask
 *    when it happened and enforce a 3-month wait, shown here before submission so the citizen
 *    isn't surprised by a 409.
 */
export default function NationalIdRenewReplace() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [eligibility, setEligibility] = useState(null);
  const [eligibilityError, setEligibilityError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/home-affairs/national-id/eligibility')
      .then(setEligibility)
      .catch((err) => setEligibilityError(err.message || t('common.somethingWentWrong')));
  }, []);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  const card = eligibility?.collectedCard;
  const waitEligibleFrom = form.reportedLostAt && ['Lost', 'Stolen'].includes(form.replacementReason)
    ? (() => { const d = new Date(form.reportedLostAt); d.setUTCMonth(d.getUTCMonth() + (eligibility?.lostWaitMonths || 3)); return d; })()
    : null;
  const stillWaiting = waitEligibleFrom && waitEligibleFrom > new Date();

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const result = await api.post('/home-affairs/national-id/renew-replace', form);
      navigate(`/home-affairs/national-id/${result.nationalIdCardId}`);
    } catch (err) { setError(err.message || t('common.somethingWentWrong')); } finally { setBusy(false); }
  }

  if (!eligibility && !eligibilityError) return <Loading />;

  return (
    <div>
      <BackToDepartment />
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.nationalIdRenewReplace')}</h1>
      <p className="mb-6 text-sm text-slate-600">{t('homeAffairs.nationalIdRenewReplaceForm.intro')}</p>

      {eligibilityError && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {eligibilityError}</p>}

      {eligibility && !card ? (
        <div className="card">
          <p className="text-sm text-gov-amber">⚠ {t('homeAffairs.nationalIdRenewReplaceForm.noCardFound')}</p>
        </div>
      ) : eligibility && eligibility.hasInProgressApplication ? (
        <div className="card">
          <p className="text-sm text-gov-amber">⚠ {t('homeAffairs.nationalIdForm.alreadyInProgress')}</p>
        </div>
      ) : card ? (
        <>
          <div className="card mb-4">
            <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">{t('homeAffairs.nationalIdRenewReplaceForm.currentCard')}</p>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex h-32 w-28 flex-none items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                {card.photoReference ? (
                  <img src={`/uploads/${card.photoReference}`} alt={t('homeAffairs.nationalIdCardView.field.photo')} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-3xl text-slate-300" aria-hidden="true">🪪</span>
                )}
              </div>
              <dl className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">{t('homeAffairs.nationalIdCardView.field.fullName')}</dt>
                  <dd className="font-medium">{[card.firstName, card.middleName, card.lastName].filter(Boolean).join(' ')}</dd>
                </div>
                <div><dt className="text-xs text-slate-500">{t('homeAffairs.nationalIdCardView.field.idNumber')}</dt><dd className="font-mono font-medium">{card.permanentIdentityNumber || card.cardNumber}</dd></div>
                <div><dt className="text-xs text-slate-500">{t('homeAffairs.nationalIdCardView.field.cardNumber')}</dt><dd className="font-mono font-medium">{card.cardNumber}</dd></div>
                {card.dateOfBirth && <div><dt className="text-xs text-slate-500">{t('homeAffairs.nationalIdCardView.field.dateOfBirth')}</dt><dd className="font-medium">{formatDateOnly(card.dateOfBirth)}</dd></div>}
                {card.sex && <div><dt className="text-xs text-slate-500">{t('homeAffairs.nationalIdCardView.field.sex')}</dt><dd className="font-medium">{card.sex}</dd></div>}
                <div><dt className="text-xs text-slate-500">{t('homeAffairs.nationalIdCardView.field.dateOfIssue')}</dt><dd className="font-medium">{formatDateOnly(card.approvalDate)}</dd></div>
                <div>
                  <dt className="text-xs text-slate-500">{t('homeAffairs.nationalIdCardView.field.dateOfExpiry')}</dt>
                  <dd className={`font-medium ${card.isExpired ? 'text-gov-red' : 'text-gov-green'}`}>{formatDateOnly(card.expiryDate)} {card.isExpired ? `(${t('homeAffairs.nationalIdRenewReplaceForm.expired')})` : `(${t('homeAffairs.nationalIdRenewReplaceForm.notExpired')})`}</dd>
                </div>
              </dl>
            </div>
          </div>

          <form onSubmit={onSubmit} className="card" noValidate>
            {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}

            <FormField label={t('homeAffairs.nationalIdRenewReplaceForm.field.applicationType')} htmlFor="applicationType" required>
              <select id="applicationType" required className="form-input" value={form.applicationType} onChange={(e) => update('applicationType', e.target.value)}>
                <option value="Renewal">{t('homeAffairs.nationalIdRenewReplaceForm.renewal')}</option>
                <option value="Replacement">{t('homeAffairs.nationalIdRenewReplaceForm.replacement')}</option>
              </select>
            </FormField>

            {form.applicationType === 'Renewal' && !card.isExpired && (
              <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
                ⚠ {t('homeAffairs.nationalIdRenewReplaceForm.notYetExpiredNotice', { expiryDate: formatDateOnly(card.expiryDate) })}
              </p>
            )}

            {form.applicationType === 'Replacement' && (
              <>
                <FormField label={t('homeAffairs.nationalIdRenewReplaceForm.field.replacementReason')} htmlFor="replacementReason" required>
                  <select id="replacementReason" required className="form-input" value={form.replacementReason} onChange={(e) => update('replacementReason', e.target.value)}>
                    <option value="">—</option>
                    <option value="Lost">{t('homeAffairs.replacementReason.lost')}</option>
                    <option value="Stolen">{t('homeAffairs.replacementReason.stolen')}</option>
                    <option value="Damaged">{t('homeAffairs.replacementReason.damaged')}</option>
                  </select>
                </FormField>
                <FormField label={t('homeAffairs.nationalIdRenewReplaceForm.field.replacementDetails')} htmlFor="replacementDetails" help={t('common.optional')}>
                  <textarea id="replacementDetails" rows={3} className="form-input" value={form.replacementDetails} onChange={(e) => update('replacementDetails', e.target.value)} />
                </FormField>

                {['Lost', 'Stolen'].includes(form.replacementReason) && (
                  <>
                    <FormField label={t('homeAffairs.nationalIdRenewReplaceForm.field.reportedLostAt', { reason: t(`homeAffairs.replacementReason.${form.replacementReason.toLowerCase()}`) })} htmlFor="reportedLostAt" required>
                      <input id="reportedLostAt" type="date" required max={new Date().toISOString().slice(0, 10)} className="form-input" value={form.reportedLostAt} onChange={(e) => update('reportedLostAt', e.target.value)} />
                    </FormField>
                    {form.reportedLostAt && (
                      stillWaiting ? (
                        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-gov-amber">
                          ⚠ {t('homeAffairs.nationalIdRenewReplaceForm.waitNotice', { months: eligibility.lostWaitMonths, date: formatDateOnly(waitEligibleFrom.toISOString().slice(0, 10)) })}
                        </p>
                      ) : (
                        <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">✓ {t('homeAffairs.nationalIdRenewReplaceForm.waitPassedNotice', { months: eligibility.lostWaitMonths })}</p>
                      )
                    )}
                  </>
                )}

                <DocumentCapture
                  label={t('homeAffairs.nationalIdRenewReplaceForm.field.replacementProof')}
                  help={t('homeAffairs.nationalIdRenewReplaceForm.field.replacementProofHelp')}
                  value={form.replacementProofReference}
                  onChange={(ref) => update('replacementProofReference', ref)}
                  required
                />
              </>
            )}

            <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              ℹ {t('homeAffairs.nationalIdRenewReplaceForm.photoReused')}
            </p>

            <DistrictOfficeSelect departmentKey="home_affairs" value={form.preferredOfficeId} onChange={(id) => update('preferredOfficeId', id)} />

            <button
              type="submit"
              disabled={busy || (form.applicationType === 'Renewal' && !card.isExpired) || (form.applicationType === 'Replacement' && stillWaiting)}
              className="btn-primary"
            >
              {busy ? t('common.loading') : t('common.submit')}
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
