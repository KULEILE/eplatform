import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/layout/ProtectedRoute';

import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Departments from './pages/Departments';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Notifications from './pages/Notifications';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import ChangePassword from './pages/ChangePassword';
import Appointments from './pages/Appointments';
import AppointmentApply from './pages/AppointmentApply';

import HomeAffairsHub from './pages/homeAffairs/HomeAffairsHub';
import BirthRegistrationList from './pages/homeAffairs/BirthRegistrationList';
import BirthRegistrationApply from './pages/homeAffairs/BirthRegistrationApply';
import BirthRegistrationDetail from './pages/homeAffairs/BirthRegistrationDetail';
import BirthCertificate from './pages/homeAffairs/BirthCertificate';
import NationalIdApply from './pages/homeAffairs/NationalIdApply';
import NationalIdDetail from './pages/homeAffairs/NationalIdDetail';
import NationalIdList from './pages/homeAffairs/NationalIdList';
import Corrections from './pages/homeAffairs/Corrections';
import IdentityVerification from './pages/homeAffairs/IdentityVerification';
import MarriageRegistrationApply from './pages/homeAffairs/MarriageRegistrationApply';
import MarriageRegistrationList from './pages/homeAffairs/MarriageRegistrationList';
import MarriageRegistrationDetail from './pages/homeAffairs/MarriageRegistrationDetail';
import MarriageCertificate from './pages/homeAffairs/MarriageCertificate';
import DivorceRegistrationApply from './pages/homeAffairs/DivorceRegistrationApply';
import DivorceRegistrationList from './pages/homeAffairs/DivorceRegistrationList';
import DivorceRegistrationDetail from './pages/homeAffairs/DivorceRegistrationDetail';
import DivorceCertificate from './pages/homeAffairs/DivorceCertificate';
import DeathRegistration from './pages/homeAffairs/DeathRegistration';
import NationalIdRenewReplace from './pages/homeAffairs/NationalIdRenewReplace';
import BirthCertificateReissue from './pages/homeAffairs/BirthCertificateReissue';
import DeathCertificateRequest from './pages/homeAffairs/DeathCertificateRequest';
import DeathCertificate from './pages/homeAffairs/DeathCertificate';
import NameChange from './pages/homeAffairs/NameChange';
import Adoption from './pages/homeAffairs/Adoption';
import BurialOrder from './pages/homeAffairs/BurialOrder';
import SpecialMarriageLicence from './pages/homeAffairs/SpecialMarriageLicence';
import MarriageSolemnisation from './pages/homeAffairs/MarriageSolemnisation';
import MarriageOfficers from './pages/homeAffairs/MarriageOfficers';
import CitizenshipNaturalization from './pages/homeAffairs/CitizenshipNaturalization';

import TrafficHub from './pages/traffic/TrafficHub';
import DrivingLicenceApply from './pages/traffic/DrivingLicenceApply';
import DrivingLicenceRenew from './pages/traffic/DrivingLicenceRenew';
import LearnerPermit from './pages/traffic/LearnerPermit';
import DrivingLicenceReplace from './pages/traffic/DrivingLicenceReplace';
import PublicDrivingPermit from './pages/traffic/PublicDrivingPermit';
import DrivingTestBookings from './pages/traffic/DrivingTestBookings';
import VehicleRegistration from './pages/traffic/VehicleRegistration';
import VehicleRegistrationImported from './pages/traffic/VehicleRegistrationImported';
import VehicleRegistrationSecondHand from './pages/traffic/VehicleRegistrationSecondHand';
import VehicleTransfer from './pages/traffic/VehicleTransfer';
import VehicleNumberPlate from './pages/traffic/VehicleNumberPlate';
import TemporaryPermit from './pages/traffic/TemporaryPermit';
import VehicleInspection from './pages/traffic/VehicleInspection';
import TransportPermitNew from './pages/traffic/TransportPermitNew';
import TransportPermitRenew from './pages/traffic/TransportPermitRenew';
import VehicleLicenceDiscApply from './pages/traffic/VehicleLicenceDiscApply';
import VehicleLicenceDiscRenew from './pages/traffic/VehicleLicenceDiscRenew';
import DrivingInstructors from './pages/traffic/DrivingInstructors';
import Finance from './pages/finance/Finance';
import GovernmentEmployment from './pages/finance/GovernmentEmployment';
import FinanceCorrections from './pages/finance/Corrections';
import Pensions from './pages/pensions/Pensions';
import Police from './pages/police/Police';
import PoliceHub from './pages/police/PoliceHub';
import PoliceClearanceApply from './pages/police/PoliceClearanceApply';
import PoliceClearanceList from './pages/police/PoliceClearanceList';
import PoliceClearanceCertificate from './pages/police/PoliceClearanceCertificate';
import PoliceCaseList from './pages/police/PoliceCaseList';
import PoliceCaseDetail from './pages/police/PoliceCaseDetail';
import Passport from './pages/passport/Passport';
import PassportDocument from './pages/passport/PassportDocument';

import AdminDashboard from './pages/admin/AdminDashboard';
import AdminSettings from './pages/admin/AdminSettings';
import AdminUsers from './pages/admin/AdminUsers';
import AdminAudit from './pages/admin/AdminAudit';
import AdminOffices from './pages/admin/AdminOffices';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/departments" element={<ProtectedRoute><Departments /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
        <Route path="/applications" element={<ProtectedRoute><Applications /></ProtectedRoute>} />
        <Route path="/applications/:id" element={<ProtectedRoute><ApplicationDetail /></ProtectedRoute>} />
        <Route path="/appointments" element={<ProtectedRoute><Appointments /></ProtectedRoute>} />
        <Route path="/appointments/apply" element={<ProtectedRoute><AppointmentApply /></ProtectedRoute>} />

        <Route path="/home-affairs" element={<ProtectedRoute><HomeAffairsHub /></ProtectedRoute>} />
        <Route path="/home-affairs/birth-registration" element={<ProtectedRoute><BirthRegistrationList /></ProtectedRoute>} />
        <Route path="/home-affairs/birth-registration/apply" element={<ProtectedRoute><BirthRegistrationApply /></ProtectedRoute>} />
        <Route path="/home-affairs/birth-registration/:id" element={<ProtectedRoute><BirthRegistrationDetail /></ProtectedRoute>} />
        <Route path="/home-affairs/birth-certificate/:id" element={<ProtectedRoute><BirthCertificate /></ProtectedRoute>} />
        <Route path="/home-affairs/national-id" element={<ProtectedRoute><NationalIdList /></ProtectedRoute>} />
        <Route path="/home-affairs/national-id/apply" element={<ProtectedRoute><NationalIdApply /></ProtectedRoute>} />
        <Route path="/home-affairs/national-id/:id" element={<ProtectedRoute><NationalIdDetail /></ProtectedRoute>} />
        <Route path="/home-affairs/corrections" element={<ProtectedRoute><Corrections /></ProtectedRoute>} />
        <Route path="/home-affairs/identity-verification" element={<ProtectedRoute><IdentityVerification /></ProtectedRoute>} />
        <Route path="/home-affairs/marriage-registration" element={<ProtectedRoute><MarriageRegistrationList /></ProtectedRoute>} />
        <Route path="/home-affairs/marriage-registration/apply" element={<ProtectedRoute><MarriageRegistrationApply /></ProtectedRoute>} />
        <Route path="/home-affairs/marriage-registration/:id" element={<ProtectedRoute><MarriageRegistrationDetail /></ProtectedRoute>} />
        <Route path="/home-affairs/marriage-certificate/:id" element={<ProtectedRoute><MarriageCertificate /></ProtectedRoute>} />
        <Route path="/home-affairs/divorce-registration" element={<ProtectedRoute><DivorceRegistrationList /></ProtectedRoute>} />
        <Route path="/home-affairs/divorce-registration/apply" element={<ProtectedRoute><DivorceRegistrationApply /></ProtectedRoute>} />
        <Route path="/home-affairs/divorce-registration/:id" element={<ProtectedRoute><DivorceRegistrationDetail /></ProtectedRoute>} />
        <Route path="/home-affairs/divorce-certificate/:id" element={<ProtectedRoute><DivorceCertificate /></ProtectedRoute>} />
        <Route path="/home-affairs/death-registration" element={<ProtectedRoute><DeathRegistration /></ProtectedRoute>} />
        <Route path="/home-affairs/national-id/renew-replace" element={<ProtectedRoute><NationalIdRenewReplace /></ProtectedRoute>} />
        <Route path="/home-affairs/birth-certificate-reissue" element={<ProtectedRoute><BirthCertificateReissue /></ProtectedRoute>} />
        <Route path="/home-affairs/death-certificate-request" element={<ProtectedRoute><DeathCertificateRequest /></ProtectedRoute>} />
        <Route path="/home-affairs/death-certificate/:id" element={<ProtectedRoute><DeathCertificate /></ProtectedRoute>} />
        <Route path="/home-affairs/name-change" element={<ProtectedRoute><NameChange /></ProtectedRoute>} />
        <Route path="/home-affairs/adoption" element={<ProtectedRoute><Adoption /></ProtectedRoute>} />
        <Route path="/home-affairs/burial-order" element={<ProtectedRoute><BurialOrder /></ProtectedRoute>} />
        <Route path="/home-affairs/special-marriage-licence" element={<ProtectedRoute><SpecialMarriageLicence /></ProtectedRoute>} />
        <Route path="/home-affairs/marriage-solemnisation" element={<ProtectedRoute><MarriageSolemnisation /></ProtectedRoute>} />
        <Route path="/home-affairs/marriage-officers" element={<ProtectedRoute><MarriageOfficers /></ProtectedRoute>} />
        <Route path="/home-affairs/naturalization" element={<ProtectedRoute><CitizenshipNaturalization /></ProtectedRoute>} />

        <Route path="/traffic" element={<ProtectedRoute><TrafficHub /></ProtectedRoute>} />
        <Route path="/traffic/driving-licence/apply" element={<ProtectedRoute><DrivingLicenceApply /></ProtectedRoute>} />
        <Route path="/traffic/driving-licence/renew" element={<ProtectedRoute><DrivingLicenceRenew /></ProtectedRoute>} />
        <Route path="/traffic/learner-permit" element={<ProtectedRoute><LearnerPermit /></ProtectedRoute>} />
        <Route path="/traffic/driving-licence/replace" element={<ProtectedRoute><DrivingLicenceReplace /></ProtectedRoute>} />
        <Route path="/traffic/public-driving-permit" element={<ProtectedRoute><PublicDrivingPermit /></ProtectedRoute>} />
        <Route path="/traffic/test-bookings" element={<ProtectedRoute><DrivingTestBookings /></ProtectedRoute>} />
        <Route path="/traffic/vehicle-registration" element={<ProtectedRoute><VehicleRegistration /></ProtectedRoute>} />
        <Route path="/traffic/vehicle-registration/imported" element={<ProtectedRoute><VehicleRegistrationImported /></ProtectedRoute>} />
        <Route path="/traffic/vehicle-registration/second-hand" element={<ProtectedRoute><VehicleRegistrationSecondHand /></ProtectedRoute>} />
        <Route path="/traffic/vehicle-transfer" element={<ProtectedRoute><VehicleTransfer /></ProtectedRoute>} />
        <Route path="/traffic/number-plate" element={<ProtectedRoute><VehicleNumberPlate /></ProtectedRoute>} />
        <Route path="/traffic/temporary-permit" element={<ProtectedRoute><TemporaryPermit /></ProtectedRoute>} />
        <Route path="/traffic/inspections" element={<ProtectedRoute><VehicleInspection /></ProtectedRoute>} />
        <Route path="/traffic/transport-permits/new" element={<ProtectedRoute><TransportPermitNew /></ProtectedRoute>} />
        <Route path="/traffic/transport-permits/renew" element={<ProtectedRoute><TransportPermitRenew /></ProtectedRoute>} />
        <Route path="/traffic/licence-disc/apply" element={<ProtectedRoute><VehicleLicenceDiscApply /></ProtectedRoute>} />
        <Route path="/traffic/licence-disc/renew" element={<ProtectedRoute><VehicleLicenceDiscRenew /></ProtectedRoute>} />
        <Route path="/traffic/instructors" element={<ProtectedRoute><DrivingInstructors /></ProtectedRoute>} />
        <Route path="/finance" element={<ProtectedRoute><Finance /></ProtectedRoute>} />
        <Route path="/finance/government-employment" element={<ProtectedRoute><GovernmentEmployment /></ProtectedRoute>} />
        <Route path="/finance/corrections" element={<ProtectedRoute><FinanceCorrections /></ProtectedRoute>} />
        <Route path="/pensions" element={<ProtectedRoute><Pensions /></ProtectedRoute>} />
        <Route path="/police" element={<ProtectedRoute><PoliceHub /></ProtectedRoute>} />
        <Route path="/police/identity-verification" element={<ProtectedRoute roles={['police_officer', 'system_administrator']}><Police /></ProtectedRoute>} />
        <Route path="/police/clearance" element={<ProtectedRoute><PoliceClearanceList /></ProtectedRoute>} />
        <Route path="/police/clearance/apply" element={<ProtectedRoute><PoliceClearanceApply /></ProtectedRoute>} />
        <Route path="/police/clearance/:id/certificate" element={<ProtectedRoute><PoliceClearanceCertificate /></ProtectedRoute>} />
        <Route path="/police/cases" element={<ProtectedRoute roles={['police_officer', 'system_administrator']}><PoliceCaseList /></ProtectedRoute>} />
        <Route path="/police/cases/:id" element={<ProtectedRoute roles={['police_officer', 'system_administrator']}><PoliceCaseDetail /></ProtectedRoute>} />
        <Route path="/passport" element={<ProtectedRoute><Passport /></ProtectedRoute>} />
        <Route path="/passport/:id" element={<ProtectedRoute><PassportDocument /></ProtectedRoute>} />

        <Route path="/admin" element={<ProtectedRoute roles={['system_administrator']}><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute roles={['system_administrator']}><AdminSettings /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute roles={['system_administrator']}><AdminUsers /></ProtectedRoute>} />
        <Route path="/admin/audit" element={<ProtectedRoute roles={['system_administrator']}><AdminAudit /></ProtectedRoute>} />
        <Route path="/admin/offices" element={<ProtectedRoute roles={['system_administrator']}><AdminOffices /></ProtectedRoute>} />

        <Route path="/branch/users" element={<ProtectedRoute roles={['branch_admin']}><AdminUsers /></ProtectedRoute>} />

        <Route path="*" element={<Landing />} />
      </Routes>
    </Layout>
  );
}
