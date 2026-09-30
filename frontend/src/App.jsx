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

import Traffic from './pages/traffic/Traffic';
import Finance from './pages/finance/Finance';
import Pensions from './pages/pensions/Pensions';
import Police from './pages/police/Police';
import PoliceHub from './pages/police/PoliceHub';
import PoliceClearanceApply from './pages/police/PoliceClearanceApply';
import PoliceClearanceList from './pages/police/PoliceClearanceList';
import PoliceClearanceCertificate from './pages/police/PoliceClearanceCertificate';
import Passport from './pages/passport/Passport';

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

        <Route path="/traffic" element={<ProtectedRoute><Traffic /></ProtectedRoute>} />
        <Route path="/finance" element={<ProtectedRoute><Finance /></ProtectedRoute>} />
        <Route path="/pensions" element={<ProtectedRoute><Pensions /></ProtectedRoute>} />
        <Route path="/police" element={<ProtectedRoute><PoliceHub /></ProtectedRoute>} />
        <Route path="/police/identity-verification" element={<ProtectedRoute roles={['police_officer', 'system_administrator']}><Police /></ProtectedRoute>} />
        <Route path="/police/clearance" element={<ProtectedRoute><PoliceClearanceList /></ProtectedRoute>} />
        <Route path="/police/clearance/apply" element={<ProtectedRoute><PoliceClearanceApply /></ProtectedRoute>} />
        <Route path="/police/clearance/:id/certificate" element={<ProtectedRoute><PoliceClearanceCertificate /></ProtectedRoute>} />
        <Route path="/passport" element={<ProtectedRoute><Passport /></ProtectedRoute>} />

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
