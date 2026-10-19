import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from '../components/ui/Loading';
import StatusBadge from '../components/ui/StatusBadge';
import BiometricCapture from '../components/BiometricCapture';
import { formatDateOnly } from '../utils/format';

export default function Profile() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [biometricStatus, setBiometricStatus] = useState(null);

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
          <div><dt className="text-xs text-slate-500">{t('auth.email')}</dt><dd className="font-medium">{user.email}</dd></div>
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

      {user.roleKey === 'citizen' && user.citizenId && (
        <div className="card mt-4">
          <h2 className="mb-1 font-semibold text-slate-800">{t('profile.biometricEnrollment')}</h2>
          <p className="mb-3 text-sm text-slate-500">{t('profile.biometricEnrollmentDesc')}</p>
          {!biometricStatus ? <Loading /> : biometricStatus.enrolled && biometricStatus.leftHand && biometricStatus.rightHand ? (
            <p className="text-sm text-gov-green">✓ {t('profile.biometricEnrolledBoth')}{biometricStatus.enrollmentSource ? ` (${biometricStatus.enrollmentSource})` : ''}</p>
          ) : (
            <div>
              {biometricStatus.enrolled && <p className="mb-3 text-sm text-gov-amber">⚠ {t('profile.biometricEnrolledOneHand')}</p>}
              {!biometricStatus.leftHand && (
                <BiometricCapture
                  value={null}
                  onChange={() => loadBiometricStatus()}
                  label={t('biometricCapture.leftHandLabel')}
                  help={t('biometricCapture.scanHint')}
                  hand="left"
                  enrollSource="Self-Enrolment"
                />
              )}
              {!biometricStatus.rightHand && (
                <BiometricCapture
                  value={null}
                  onChange={() => loadBiometricStatus()}
                  label={t('biometricCapture.rightHandLabel')}
                  help={t('biometricCapture.scanHint')}
                  hand="right"
                  enrollSource="Self-Enrolment"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
