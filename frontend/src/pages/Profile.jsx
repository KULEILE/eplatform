import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from '../components/ui/Loading';
import StatusBadge from '../components/ui/StatusBadge';
import { formatDateOnly } from '../utils/format';

function maskAccountNumber(number) {
  if (!number) return '';
  const digits = String(number);
  if (digits.length <= 4) return digits;
  return '•'.repeat(digits.length - 4) + digits.slice(-4);
}

export default function Profile() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [biometricStatus, setBiometricStatus] = useState(null);
  const [revealBank, setRevealBank] = useState(false);

  useEffect(() => {
    if (user.roleKey === 'citizen') {
      api.get('/citizen/profile').then(setProfile).catch(() => {}).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [user.roleKey]);

  function loadBiometricStatus() { api.get('/biometrics/status').then(setBiometricStatus).catch(() => {}); }
  useEffect(() => { if (user.citizenId) loadBiometricStatus(); }, [user.citizenId]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-slate-900">{t('nav.profile')}</h1>

      <div className="card mb-4">
        <h2 className="mb-3 font-semibold text-slate-800">Account</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">{t('auth.username')}</dt><dd className="font-medium">{user.username}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('auth.email')}</dt><dd className="font-medium">{user.email || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('auth.phone')}</dt><dd className="font-medium">{user.phone || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500">Role</dt><dd className="font-medium">{user.roleKey.replace(/_/g, ' ')}</dd></div>
          {user.departmentKey && <div><dt className="text-xs text-slate-500">{t('applications.department')}</dt><dd className="font-medium">{t(`departments.${user.departmentKey}`)}</dd></div>}
        </dl>
      </div>

      {user.roleKey === 'citizen' && (
        <div className="card">
          <h2 className="mb-3 font-semibold text-slate-800">{t('dashboard.identityStatus')}</h2>
          {loading ? <Loading /> : profile?.provisional ? (
            <div>
              <StatusBadge status="Provisional" />
              <p className="mt-2 text-sm text-slate-500">{profile.message}</p>
              <Link to="/home-affairs/birth-registration/apply" className="btn-primary mt-4 inline-flex">{t('homeAffairs.birthRegistration')}</Link>
            </div>
          ) : profile?.citizen ? (
            <div>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><dt className="text-xs text-slate-500">Name</dt><dd className="font-medium">{profile.citizen.first_name} {profile.citizen.middle_name} {profile.citizen.last_name}</dd></div>
                <div><dt className="text-xs text-slate-500">{t('auth.dateOfBirth')}</dt><dd className="font-medium">{formatDateOnly(profile.citizen.date_of_birth)}</dd></div>
                <div><dt className="text-xs text-slate-500">{t('auth.permanentIdentityNumber')}</dt><dd className="font-mono font-medium">{profile.citizen.permanent_identity_number}</dd></div>
                <div><dt className="text-xs text-slate-500">{t('common.status')}</dt><dd><StatusBadge status={profile.citizen.identity_verification_status} /></dd></div>
              </dl>
              <Link to="/home-affairs/corrections" className="btn-secondary mt-4 inline-flex">{t('homeAffairs.correction')}</Link>
            </div>
          ) : null}
        </div>
      )}

      {user.roleKey === 'citizen' && profile?.citizen && (
        <div className="card mt-4">
          <h2 className="mb-3 font-semibold text-slate-800">{t('finance.bankDetails.onFileTitle')}</h2>
          {profile.citizen.government_employment_status && profile.citizen.government_employment_status !== 'Not Applicable' && (
            <p className="mb-3 text-sm text-slate-600">
              {t('finance.employment.statusLabel')}: <span className="font-medium">{t(`finance.employmentStatus.${profile.citizen.government_employment_status}`)}</span>
            </p>
          )}
          {profile.citizen.bank_account_number ? (
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">{t('finance.bankDetails.field.bankName')}</dt><dd className="font-medium">{profile.citizen.bank_name}</dd></div>
              <div><dt className="text-xs text-slate-500">{t('finance.bankDetails.field.bankAccountHolderName')}</dt><dd className="font-medium">{profile.citizen.bank_account_holder_name}</dd></div>
              <div>
                <dt className="text-xs text-slate-500">{t('finance.bankDetails.field.bankAccountNumber')}</dt>
                <dd className="flex items-center gap-2 font-mono font-medium">
                  {revealBank ? profile.citizen.bank_account_number : maskAccountNumber(profile.citizen.bank_account_number)}
                  <button type="button" className="text-gov-navy" onClick={() => setRevealBank((r) => !r)}>
                    {revealBank ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                  </button>
                </dd>
              </div>
              <div><dt className="text-xs text-slate-500">{t('finance.bankDetails.field.bankBranchName')}</dt><dd className="font-medium">{profile.citizen.bank_branch_name}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">{t('finance.bankDetails.noneOnFile')}</p>
          )}
          <Link to="/finance/bank-details" className="btn-secondary mt-4 inline-flex">{t('finance.bankDetails.title')}</Link>
        </div>
      )}

      {user.roleKey === 'citizen' && user.citizenId && (
        <div className="card mt-4">
          <h2 className="mb-1 font-semibold text-slate-800">{t('profile.biometricEnrollment')}</h2>
          <p className="mb-3 text-sm text-slate-500">{t('profile.biometricEnrollmentDesc')}</p>
          {/* Batch 29 — "the biomatrix must be captured once during id application so everywhere
              they are need they used reuse that one ... there is no self biomatric captured": this
              card used to let a citizen scan their own hands right here ("Self-Enrolment") any time
              they weren't yet enrolled — the most direct form of self-capture in the whole system,
              with no officer or application context at all. It's gone. This is now read-only status:
              biometrics are captured exactly once, in person, as part of National ID enrolment (an
              officer does the scan at a police station — see NationalIdApply.jsx), and reused by
              every service after that. A citizen who isn't enrolled yet is pointed at National ID,
              never handed a camera. */}
          {!biometricStatus ? <Loading /> : biometricStatus.enrolled && biometricStatus.leftHand && biometricStatus.rightHand ? (
            <p className="text-sm text-gov-green">✓ {t('profile.biometricEnrolledBoth')}{biometricStatus.enrollmentSource ? ` (${biometricStatus.enrollmentSource})` : ''}</p>
          ) : (
            <div>
              {biometricStatus.enrolled ? (
                <p className="mb-3 text-sm text-gov-amber">⚠ {t('profile.biometricEnrolledOneHand')}</p>
              ) : (
                <p className="mb-3 text-sm text-slate-500">{t('profile.biometricNotEnrolled')}</p>
              )}
              <p className="mb-3 text-sm text-slate-500">{t('profile.biometricEnrollElsewhere')}</p>
              <Link to="/home-affairs/national-id" className="btn-secondary inline-flex">{t('homeAffairs.nationalIdCard')}</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
