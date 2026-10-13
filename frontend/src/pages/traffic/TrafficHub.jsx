import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

const SERVICES = [
  { key: 'drivingLicenceApply', to: '/traffic/driving-licence/apply', icon: '🪪', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'drivingLicenceRenew', to: '/traffic/driving-licence/renew', icon: '🔄', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'learnerPermit', to: '/traffic/learner-permit', icon: '📘', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'drivingLicenceReplace', to: '/traffic/driving-licence/replace', icon: '♻️', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'publicDrivingPermit', to: '/traffic/public-driving-permit', icon: '🚐', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'testBookings', to: '/traffic/test-bookings', icon: '📝', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'vehicleRegistration', to: '/traffic/vehicle-registration', icon: '🚗', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'vehicleRegistrationImported', to: '/traffic/vehicle-registration/imported', icon: '🚢', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'vehicleRegistrationSecondHand', to: '/traffic/vehicle-registration/second-hand', icon: '🚙', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'vehicleTransfer', to: '/traffic/vehicle-transfer', icon: '🔑', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'numberPlate', to: '/traffic/number-plate', icon: '🔢', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'temporaryPermit', to: '/traffic/temporary-permit', icon: '⏳', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'inspection', to: '/traffic/inspections', icon: '🔧', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'transportPermitNew', to: '/traffic/transport-permits/new', icon: '🚚', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'transportPermitRenew', to: '/traffic/transport-permits/renew', icon: '📦', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'licenceDiscApply', to: '/traffic/licence-disc/apply', icon: '🏷️', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'licenceDiscRenew', to: '/traffic/licence-disc/renew', icon: '🏷️', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'instructors', to: '/traffic/instructors', icon: '🎓', roles: ['traffic_officer', 'system_administrator'] },
  { key: 'applicationTracking', to: '/applications', icon: '📊', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
];

export default function TrafficHub() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const visible = SERVICES.filter((s) => s.roles.includes(user.roleKey));

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('departments.traffic')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('traffic.hubIntro')}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => (
          <Link key={s.key} to={s.to} className="card flex items-center gap-3 hover:-translate-y-0.5 hover:shadow-md transition">
            <span className="text-2xl" aria-hidden="true">{s.icon}</span>
            <span className="font-semibold text-slate-900">{t(`traffic.hub.${s.key}`)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
