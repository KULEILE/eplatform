import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

const CITIZEN_AND_OFFICER = ['citizen', 'police_officer', 'system_administrator'];

const SERVICES = [
  { key: 'clearance', to: '/police/clearance', icon: '📄', roles: CITIZEN_AND_OFFICER, labelKey: 'police.clearance.title' },
  { key: 'lostProperty', to: '/police/reports/lost-property', icon: '🧳', roles: CITIZEN_AND_OFFICER, labelKey: 'police.reports.lostProperty.title' },
  { key: 'stolenProperty', to: '/police/reports/stolen-property', icon: '🚨', roles: CITIZEN_AND_OFFICER, labelKey: 'police.reports.stolenProperty.title' },
  { key: 'generalCrime', to: '/police/reports/general-crime', icon: '📣', roles: CITIZEN_AND_OFFICER, labelKey: 'police.reports.generalCrime.title' },
  { key: 'cybercrime', to: '/police/reports/cybercrime', icon: '💻', roles: CITIZEN_AND_OFFICER, labelKey: 'police.reports.cybercrime.title' },
  { key: 'missingPerson', to: '/police/reports/missing-person', icon: '🧍', roles: CITIZEN_AND_OFFICER, labelKey: 'police.reports.missingPerson.title' },
  { key: 'domesticViolence', to: '/police/reports/domestic-violence', icon: '🛟', roles: CITIZEN_AND_OFFICER, labelKey: 'police.reports.domesticViolence.title' },
  { key: 'trafficAccident', to: '/police/reports/traffic-accident', icon: '🚗', roles: CITIZEN_AND_OFFICER, labelKey: 'police.reports.trafficAccident.title' },
  { key: 'complaint', to: '/police/reports/complaint', icon: '📝', roles: CITIZEN_AND_OFFICER, labelKey: 'police.reports.complaint.title' },
  { key: 'caseTrack', to: '/police/cases/track', icon: '🔍', roles: ['citizen'], labelKey: 'police.track.title' },
  { key: 'appointmentBooking', to: '/appointments/apply', icon: '📅', roles: ['citizen'], labelKey: 'appointments.bookNew' },
  { key: 'informationRequest', to: '/police/information-request', icon: '❓', roles: CITIZEN_AND_OFFICER, labelKey: 'police.reports.information.title' },
  { key: 'information', to: '/police/information', icon: 'ℹ️', roles: CITIZEN_AND_OFFICER, labelKey: 'police.information.title' },
  { key: 'identityLookup', to: '/police/identity-verification', icon: '🔎', roles: ['police_officer', 'system_administrator'], labelKey: 'police.identityLookup' },
  { key: 'cases', to: '/police/cases', icon: '🗂️', roles: ['police_officer', 'system_administrator'], labelKey: 'police.cases.navLabel' },
];

/** Every citizen-facing service from the department's full service list is represented here —
 *  the Police Clearance Certificate, all eight incident/request reporting services, case
 *  tracking by reference number, appointment booking (reusing the existing cross-department
 *  Appointments system — Police has always been a valid departmentKey there, see
 *  AppointmentApply.jsx), and Police Information — plus the two officer-only tools
 *  (Identity Verification, Case Management). */
export default function PoliceHub() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const visible = SERVICES.filter((s) => s.roles.includes(user.roleKey));

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-slate-900">{t('departments.police')}</h1>
      <p className="mb-6 text-sm text-slate-500">{t('police.services')}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => (
          <Link key={s.key} to={s.to} className="card flex items-center gap-3 hover:-translate-y-0.5 hover:shadow-md transition">
            <span className="text-2xl" aria-hidden="true">{s.icon}</span>
            <span className="font-semibold text-slate-900">{t(s.labelKey)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
