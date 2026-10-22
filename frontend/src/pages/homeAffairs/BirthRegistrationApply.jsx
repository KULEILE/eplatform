import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../api/client';
import FormField from '../../components/ui/FormField';
import DistrictOfficeSelect from '../../components/DistrictOfficeSelect';
import ParentIdentityFields from '../../components/ParentIdentityFields';
import DocumentCapture from '../../components/DocumentCapture';

const BLANK_PARENT = { name: '', nationality: 'Mosotho', isCitizen: true, identityNumber: '', passportNumber: '', passportImageReference: '' };

/**
 * A logged-in parent/guardian registers their child's birth. Since migration 059, this is fully
 * automatic: each parent's permanent identity number is checked against the citizens register
 * the moment the form is submitted, and the application is approved (certificate generated
 * immediately) or rejected (with a clear reason) in that same step — there is no officer review
 * queue for a new application any more.
 */
export default function BirthRegistrationApply() {
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
  const [preferredOfficeId, setPreferredOfficeId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { status, referenceNumber, certificateNumber?, rejectionReason?, birthRecordId }

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (!preferredOfficeId) { setError(t('offices.chooseBranchRequired')); return; }
    setBusy(true);
    try {
      const payload = {
        ...form, preferredOfficeId,
        fatherName: father.name, fatherNationality: father.nationality, fatherIsCitizen: father.isCitizen,
        fatherIdentityNumber: father.identityNumber, fatherPassportNumber: father.passportNumber, fatherPassportImageReference: father.passportImageReference,
        motherName: mother.name, motherNationality: mother.nationality, motherIsCitizen: mother.isCitizen,
        motherIdentityNumber: mother.identityNumber, motherPassportNumber: mother.passportNumber, motherPassportImageReference: mother.passportImageReference,
        chiefLetterImageReference, proofOfBirthImageReference,
        marriageCertificateImageReference: marriageCertificateImageReference || undefined,
        acknowledgementOfPaternityImageReference: acknowledgementOfPaternityImageReference || undefined,
      };
      const r = await api.post('/home-affairs/birth-registration', payload);
      setResult(r);
    } catch (err) {
      setError(err.message || t('common.somethingWentWrong'));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('homeAffairs.birthRegistrationForm.title')}</h1>
        <div className="card">
          {result.status === 'Approved' ? (
            <>
              <p className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-gov-green">
                ✓ {t('homeAffairs.birthRegistrationForm.approvedResult', { certificateNumber: result.certificateNumber })}
              </p>
              <button type="button" className="btn-primary w-full" onClick={() => navigate(`/home-affairs/birth-registration/${result.birthRecordId}`)}>
                {t('common.viewDetails')}
              </button>
            </>
          ) : (
            <>
              <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">
                ⚠ {t('homeAffairs.birthRegistrationForm.rejectedResult', { reason: result.rejectionReason })}
              </p>
              <button type="button" className="btn-primary w-full" onClick={() => setResult(null)}>
                {t('homeAffairs.birthRegistrationForm.applyAgain')}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('homeAffairs.birthRegistrationForm.title')}</h1>
      <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">ℹ {t('homeAffairs.birthRegistrationForm.automaticNotice')}</p>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-gov-red" role="alert">⚠ {error}</p>}
      <form onSubmit={onSubmit} className="card" noValidate>
        <FormField label={t('homeAffairs.birthRegistrationForm.childFirstName')} htmlFor="cfn" required>
          <input id="cfn" required className="form-input" value={form.childFirstName} onChange={(e) => update('childFirstName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.childMiddleName')} htmlFor="cmn">
          <input id="cmn" className="form-input" value={form.childMiddleName} onChange={(e) => update('childMiddleName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.childLastName')} htmlFor="cln" required>
          <input id="cln" required className="form-input" value={form.childLastName} onChange={(e) => update('childLastName', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.dateOfBirth')} htmlFor="dob" required>
          <input id="dob" type="date" required className="form-input" value={form.dateOfBirth} onChange={(e) => update('dateOfBirth', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.placeOfBirth')} htmlFor="pob" required>
          <input id="pob" required className="form-input" value={form.placeOfBirth} onChange={(e) => update('placeOfBirth', e.target.value)} />
        </FormField>
        <FormField label={t('homeAffairs.birthRegistrationForm.sex')} htmlFor="sex" required>
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

        <DistrictOfficeSelect departmentKey="home_affairs" value={preferredOfficeId} onChange={setPreferredOfficeId} />
        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? t('common.loading') : t('homeAffairs.birthRegistrationForm.submit')}</button>
      </form>
    </div>
  );
}
