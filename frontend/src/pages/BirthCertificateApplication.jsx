import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import FormField from '../components/ui/FormField';
import ParentIdentityFields from '../components/ParentIdentityFields';
import DocumentCapture from '../components/DocumentCapture';

const BLANK_PARENT = { name: '', nationality: 'Mosotho', isCitizen: true, identityNumber: '', passportNumber: '', passportImageReference: '' };

/**
 * PUBLIC, no login required — the entry point for an adult with no Lesotho identity number at
 * all, applying for their OWN birth certificate as the first step toward getting an account (see
 * Register.jsx and migration 059). Posts to the unauthenticated
 * POST /api/birth-certificate-applications, which checks both parents' permanent identity
 * numbers against the civil register and approves or rejects the application immediately —
 * there is no officer review for this, so nothing here can check whether the chief's letter
 * genuinely carries a stamp; the citizen is told about that requirement before they upload it.
 */
export default function BirthCertificateApplication() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    childFirstName: '', childMiddleName: '', childLastName: '', dateOfBirth: '', placeOfBirth: '', sex: 'Male',
    motherMaidenSurname: '', motherResidence: '',
  });
  const [father, setFather] = useState(BLANK_PARENT);
  const [mother, setMother] = useState(BLANK_PARENT);
  const [chiefLetterImageReference, setChiefLetterImageReference] = useState('');
  const [proofOfBirthImageReference, setProofOfBirthImageReference] = useState('');
  const [marriageCertificateImageReference, setMarriageCertificateImageReference] = useState('');
  const [acknowledgementOfPaternityImageReference, setAcknowledgementOfPaternityImageReference] = useState('');
  const [error, setError] = useState('');
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { status, permanentIdentityNumber?, certificateNumber?, rejectionReason? }

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setAlreadyVerified(false);
    setBusy(true);
    try {
      const payload = {
        ...form,
        fatherName: father.name, fatherNationality: father.nationality, fatherIsCitizen: father.isCitizen,
        fatherIdentityNumber: father.identityNumber, fatherPassportNumber: father.passportNumber, fatherPassportImageReference: father.passportImageReference,
        motherName: mother.name, motherNationality: mother.nationality, motherIsCitizen: mother.isCitizen,
        motherIdentityNumber: mother.identityNumber, motherPassportNumber: mother.passportNumber, motherPassportImageReference: mother.passportImageReference,
        chiefLetterImageReference, proofOfBirthImageReference,
        marriageCertificateImageReference: marriageCertificateImageReference || undefined,
        acknowledgementOfPaternityImageReference: acknowledgementOfPaternityImageReference || undefined,
      };
      const r = await api.post('/birth-certificate-applications', payload);
      setResult(r);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
      // A logged-in citizen who already has an identity gets refused here (see
      // homeAffairs.controller.js's applyForBirthCertificatePublic) — point them at a reissue
      // instead of leaving them stuck on a plain error with no next step.
      setAlreadyVerified(!!err.data?.alreadyVerified);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="card">
          {result.status === 'Approved' ? (
            <>
              <h1 className="mb-4 text-xl font-bold text-slate-900">{t('homeAffairs.birthCertificateApplicationForm.approvedTitle')}</h1>
              <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">
                ✓ {t('homeAffairs.birthCertificateApplicationForm.approvedBody', { pin: result.permanentIdentityNumber, certificateNumber: result.certificateNumber })}
              </p>
              <button
                type="button"
                className="btn-primary w-full"
                onClick={() => navigate('/register', { state: { prefillPin: result.permanentIdentityNumber, prefillDob: form.dateOfBirth } })}
              >
                {t('homeAffairs.birthCertificateApplicationForm.continueToRegister')}
              </button>
            </>
          ) : (
            <>
              <h1 className="mb-4 text-xl font-bold text-slate-900">{t('homeAffairs.birthCertificateApplicationForm.rejectedTitle')}</h1>
              <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {result.rejectionReason}</p>
              <div className="flex gap-3">
                <Link to="/register" className="btn-secondary flex-1 text-center">{t('homeAffairs.birthCertificateApplicationForm.backToRegister')}</Link>
                <button type="button" className="btn-primary flex-1" onClick={() => setResult(null)}>{t('homeAffairs.birthRegistrationForm.applyAgain')}</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-10">
      <h1 className="mb-2 text-2xl font-bold text-slate-900">{t('homeAffairs.birthCertificateApplicationForm.title')}</h1>
      <p className="mb-4 text-sm text-slate-600">{t('homeAffairs.birthCertificateApplicationForm.intro')}</p>
      <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">ℹ {t('homeAffairs.birthRegistrationForm.automaticNotice')}</p>
      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">
          <p>⚠ {error}</p>
          {alreadyVerified && (
            <p className="mt-2">
              <Link to="/home-affairs/birth-certificate-reissue" className="font-semibold underline">
                {t('homeAffairs.birthCertificateApplicationForm.goToReissue')}
              </Link>
            </p>
          )}
        </div>
      )}
      <form onSubmit={onSubmit} className="card" noValidate>
        <FormField label={t('homeAffairs.birthCertificateApplicationForm.applicantFirstName')} htmlFor="cfn" required>
          <input id="cfn" required className="form-input" value={form.childFirstName} onChange={(e) => update('childFirstName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthCertificateApplicationForm.applicantMiddleName')} htmlFor="cmn">
          <input id="cmn" className="form-input" value={form.childMiddleName} onChange={(e) => update('childMiddleName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthCertificateApplicationForm.applicantLastName')} htmlFor="cln" required>
          <input id="cln" required className="form-input" value={form.childLastName} onChange={(e) => update('childLastName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthCertificateApplicationForm.applicantDateOfBirth')} htmlFor="dob" required>
          <input id="dob" type="date" required className="form-input" value={form.dateOfBirth} onChange={(e) => update('dateOfBirth', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthCertificateApplicationForm.applicantPlaceOfBirth')} htmlFor="pob" required>
          <input id="pob" required className="form-input" value={form.placeOfBirth} onChange={(e) => update('placeOfBirth', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthCertificateApplicationForm.applicantSex')} htmlFor="sex" required>
          <select id="sex" className="form-input" value={form.sex} onChange={(e) => update('sex', e.target.value)}>
            <option>Male</option><option>Female</option><option>Other</option><option>Unspecified</option>
          </select>
        </FormField>

        <p className="form-label mb-2 mt-6 border-t border-slate-100 pt-4 !text-sm font-semibold uppercase tracking-wide text-slate-500">{t('homeAffairs.birthRegistrationForm.fatherDetails')}</p>
        <ParentIdentityFields role="father" idPrefix="father" value={father} onChange={setFather} />

        <p className="form-label mb-2 mt-6 border-t border-slate-100 pt-4 !text-sm font-semibold uppercase tracking-wide text-slate-500">{t('homeAffairs.birthRegistrationForm.motherDetails')}</p>
        <ParentIdentityFields role="mother" idPrefix="mother" value={mother} onChange={setMother} />
        <FormField label={t('homeAffairs.birthRegistrationForm.motherMaidenSurname')} htmlFor="motherMaidenSurname">
          <input id="motherMaidenSurname" className="form-input" value={form.motherMaidenSurname} onChange={(e) => update('motherMaidenSurname', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.motherResidence')} htmlFor="motherResidence">
          <input id="motherResidence" className="form-input" value={form.motherResidence} onChange={(e) => update('motherResidence', e.target.value)} />
        </FormField>

        <p className="form-label mb-2 mt-6 border-t border-slate-100 pt-4 !text-sm font-semibold uppercase tracking-wide text-slate-500">{t('homeAffairs.birthRegistrationForm.uploadDocuments')}</p>
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-gov-amber">⚠ {t('homeAffairs.birthRegistrationForm.chiefLetterStampNotice')}</p>
        <DocumentCapture
          label={t('homeAffairs.birthRegistrationForm.chiefLetter')}
          help={t('homeAffairs.birthRegistrationForm.chiefLetterHelp')}
          value={chiefLetterImageReference}
          onChange={setChiefLetterImageReference}
          required
        />
        <DocumentCapture
          label={t('homeAffairs.birthRegistrationForm.proofOfBirth')}
          help={t('homeAffairs.birthRegistrationForm.proofOfBirthHelp')}
          value={proofOfBirthImageReference}
          onChange={setProofOfBirthImageReference}
          required
        />
        <DocumentCapture
          label={t('homeAffairs.birthRegistrationForm.marriageCertificate')}
          help={t('homeAffairs.birthRegistrationForm.marriageCertificateHelp')}
          value={marriageCertificateImageReference}
          onChange={setMarriageCertificateImageReference}
        />
        <DocumentCapture
          label={t('homeAffairs.birthRegistrationForm.acknowledgementOfPaternity')}
          help={t('homeAffairs.birthRegistrationForm.acknowledgementOfPaternityHelp')}
          value={acknowledgementOfPaternityImageReference}
          onChange={setAcknowledgementOfPaternityImageReference}
        />

        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? t('common.loading') : t('homeAffairs.birthCertificateApplicationForm.submit')}</button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-600">
        <Link to="/register" className="font-medium text-gov-navy hover:underline">{t('homeAffairs.birthCertificateApplicationForm.backToRegister')}</Link>
      </p>
    </div>
  );
}
