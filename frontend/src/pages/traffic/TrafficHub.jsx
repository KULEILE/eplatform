import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

const SERVICES = [
  // Application / Renewal / Replacement are now one service with a selector — see
  // DrivingLicence.jsx — instead of three separate tiles/pages, per the explicit request to stop
  // duplicating "renew" and "replace" as their own services.
  { key: 'drivingLicence', to: '/traffic/driving-licence', icon: '🪪', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  // Batch 20: the separate "Learner Permit" tile was removed — "we learner permit and driving
  // theory test which make the same work that is repetition." A Learner's Permit is produced
  // entirely by passing the Theory then Practical test below, so its read-only status view now
  // lives as a section of the "testBookings" page instead — see DrivingTestBookings.jsx.
  { key: 'publicDrivingPermit', to: '/traffic/public-driving-permit', icon: '🚐', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'testBookings', to: '/traffic/test-bookings', icon: '📝', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  // Batch 30 — "do not duplicate the services ... its renewal they must in one place": New,
  // Imported/SADC and Second-Hand registration are one tile/page now (VehicleRegistration.jsx),
  // same for Transport Permit's New/Renewal and Vehicle Licence Disc's Application/Renewal.
  // "temporaryPermit" tile is gone entirely — a Temporary Permit is no longer something a citizen
  // applies for; it's auto-created when a registration is approved and auto-converts to a
  // permanent Number Plate after its 21-day validity (see traffic.controller.js).
  { key: 'vehicleRegistration', to: '/traffic/vehicle-registration', icon: '🚗', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'vehicleTransfer', to: '/traffic/vehicle-transfer', icon: '🔑', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'numberPlate', to: '/traffic/number-plate', icon: '🔢', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'inspection', to: '/traffic/inspections', icon: '🔧', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'transportPermit', to: '/traffic/transport-permits', icon: '🚚', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
  { key: 'licenceDisc', to: '/traffic/licence-disc', icon: '🏷️', roles: ['citizen', 'traffic_officer', 'system_administrator'] },
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
