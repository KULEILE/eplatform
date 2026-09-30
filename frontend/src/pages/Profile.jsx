import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { api } from '../api/client';
import Loading from '../components/ui/Loading';
import StatusBadge from '../components/ui/StatusBadge';
import { formatDateOnly } from '../utils/format';

export default function Profile() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user.roleKey === 'citizen') {
      api.get('/citizen/profile').then(setProfile).catch(() => {}).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [user.roleKey]);

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
    </div>
  );
}
