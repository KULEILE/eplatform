import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/layout/ProtectedRoute';

import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import BirthCertificateApplication from './pages/BirthCertificateApplication';
import ForgotPassword from './pages/ForgotPassword';
import HelpCenter from './pages/HelpCenter';
import AboutUs from './pages/AboutUs';
import ContactUs from './pages/ContactUs';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfUse from './pages/TermsOfUse';
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
import BirthCertificates from './pages/homeAffairs/BirthCertificates';
import ParentConfirmations from './pages/homeAffairs/ParentConfirmations';
import ParentageDisputes from './pages/homeAffairs/ParentageDisputes';
import DeathCertificate from './pages/homeAffairs/DeathCertificate';
import NameChange from './pages/homeAffairs/NameChange';
import Adoption from './pages/homeAffairs/Adoption';
import MarriageSolemnisation from './pages/homeAffairs/MarriageSolemnisation';
import MarriageOfficers from './pages/homeAffairs/MarriageOfficers';
import CitizenshipNaturalization from './pages/homeAffairs/CitizenshipNaturalization';
import MarriageCitizenship from './pages/homeAffairs/MarriageCitizenship';

import TrafficHub from './pages/traffic/TrafficHub';
import DrivingLicence from './pages/traffic/DrivingLicence';
import DrivingLicenceDocument from './pages/traffic/DrivingLicenceDocument';
// Batch 20: LearnerPermit.jsx (and its /traffic/learner-permit route below) were removed — its
// read-only status content now lives inside DrivingTestBookings.jsx instead. See TrafficHub.jsx.
import PublicDrivingPermit from './pages/traffic/PublicDrivingPermit';
import DrivingTestBookings from './pages/traffic/DrivingTestBookings';
// Batch 30: VehicleRegistrationImported.jsx, VehicleRegistrationSecondHand.jsx,
// TransportPermitNew.jsx, TransportPermitRenew.jsx, VehicleLicenceDiscApply.jsx,
// VehicleLicenceDiscRenew.jsx, and TemporaryPermit.jsx were all removed — each pair of
// duplicate/related pages is now one consolidated page (VehicleRegistration.jsx,
// TransportPermit.jsx, VehicleLicenceDisc.jsx) with a type selector, and Temporary Permit is no
// longer citizen-facing (it's now auto-created on registration approval). See TrafficHub.jsx.
import VehicleRegistration from './pages/traffic/VehicleRegistration';
import VehicleTransfer from './pages/traffic/VehicleTransfer';
import VehicleNumberPlate from './pages/traffic/VehicleNumberPlate';
import VehicleInspection from './pages/traffic/VehicleInspection';
import TransportPermit from './pages/traffic/TransportPermit';
import VehicleLicenceDisc from './pages/traffic/VehicleLicenceDisc';
import DrivingInstructors from './pages/traffic/DrivingInstructors';
import Finance from './pages/finance/Finance';
import GovernmentEmployment from './pages/finance/GovernmentEmployment';
import FinanceCorrections from './pages/finance/Corrections';
import SupplierPaymentTracking from './pages/finance/SupplierPaymentTracking';
import FinanceComplaint from './pages/finance/FinanceComplaint';
import RetirementTracking from './pages/finance/RetirementTracking';
import BudgetAndTenders from './pages/finance/BudgetAndTenders';
import ReportFinancialIssue from './pages/finance/ReportFinancialIssue';
import FinanceBudgetRequests from './pages/finance/FinanceBudgetRequests';
import BankDetails from './pages/finance/BankDetails';
import EmployeeRoster from './pages/finance/EmployeeRoster';
import Pensions from './pages/pensions/Pensions';
import PensionEnquiry from './pages/pensions/PensionEnquiry';
import PensionPayments from './pages/pensions/PensionPayments';
import Police from './pages/police/Police';
import PoliceHub from './pages/police/PoliceHub';
import NationalIdBiometricCapture from './pages/police/NationalIdBiometricCapture';
import PoliceClearanceApply from './pages/police/PoliceClearanceApply';
import PoliceClearanceList from './pages/police/PoliceClearanceList';
import PoliceClearanceCertificate from './pages/police/PoliceClearanceCertificate';
import PoliceCaseList from './pages/police/PoliceCaseList';
import PoliceCaseDetail from './pages/police/PoliceCaseDetail';
import PoliceCaseTrack from './pages/police/PoliceCaseTrack';
import PoliceSentenceAmendments from './pages/police/PoliceSentenceAmendments';
import PoliceInformation from './pages/police/PoliceInformation';
import PoliceInformationRequest from './pages/police/PoliceInformationRequest';
import LostPropertyReport from './pages/police/LostPropertyReport';
import StolenPropertyReport from './pages/police/StolenPropertyReport';
import GeneralCrimeReport from './pages/police/GeneralCrimeReport';
import CybercrimeReport from './pages/police/CybercrimeReport';
import MissingPersonReport from './pages/police/MissingPersonReport';
import DomesticViolenceReport from './pages/police/DomesticViolenceReport';
import TrafficAccidentReport from './pages/police/TrafficAccidentReport';
import PoliceComplaint from './pages/police/PoliceComplaint';
import Passport from './pages/passport/Passport';
import PassportDocument from './pages/passport/PassportDocument';

import AdminDashboard from './pages/admin/AdminDashboard';
import AdminSettings from './pages/admin/AdminSettings';
import AdminUsers from './pages/admin/AdminUsers';
import AdminAudit from './pages/admin/AdminAudit';
import AdminOffices from './pages/admin/AdminOffices';
import BranchBudgetRequests from './pages/admin/BranchBudgetRequests';
import DeptFinanceHub from './pages/deptFinance/DeptFinanceHub';
import DeptFinanceIssues from './pages/deptFinance/DeptFinanceIssues';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/apply-for-birth-certificate" element={<BirthCertificateApplication />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        {/* Batch 39 — Help Centre and the informational cluster next to it (About Us, Contact,
            Privacy Policy, Terms of Use). All public: these are exactly the links shown in the
            Header's top utility bar and the Footer, both of which render on the pre-login Landing
            page too, so none of these can require a login. */}
        <Route path="/help" element={<HelpCenter />} />
        <Route path="/about" element={<AboutUs />} />
        <Route path="/contact" element={<ContactUs />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-of-use" element={<TermsOfUse />} />

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
        <Route path="/home-affairs/birth-certificates" element={<ProtectedRoute><BirthCertificates /></ProtectedRoute>} />
        <Route path="/home-affairs/parent-confirmations" element={<ProtectedRoute><ParentConfirmations /></ProtectedRoute>} />
        <Route path="/home-affairs/parentage-disputes" element={<ProtectedRoute><ParentageDisputes /></ProtectedRoute>} />
        <Route path="/home-affairs/death-certificate/:id" element={<ProtectedRoute><DeathCertificate /></ProtectedRoute>} />
        <Route path="/home-affairs/name-change" element={<ProtectedRoute><NameChange /></ProtectedRoute>} />
        <Route path="/home-affairs/adoption" element={<ProtectedRoute><Adoption /></ProtectedRoute>} />
        <Route path="/home-affairs/marriage-solemnisation" element={<ProtectedRoute><MarriageSolemnisation /></ProtectedRoute>} />
        <Route path="/home-affairs/marriage-officers" element={<ProtectedRoute><MarriageOfficers /></ProtectedRoute>} />
        <Route path="/home-affairs/naturalization" element={<ProtectedRoute><CitizenshipNaturalization /></ProtectedRoute>} />
        <Route path="/home-affairs/marriage-citizenship" element={<ProtectedRoute><MarriageCitizenship /></ProtectedRoute>} />

        <Route path="/traffic" element={<ProtectedRoute><TrafficHub /></ProtectedRoute>} />
        <Route path="/traffic/driving-licence" element={<ProtectedRoute><DrivingLicence /></ProtectedRoute>} />
        <Route path="/traffic/driving-licence/:id" element={<ProtectedRoute><DrivingLicenceDocument /></ProtectedRoute>} />
        <Route path="/traffic/public-driving-permit" element={<ProtectedRoute><PublicDrivingPermit /></ProtectedRoute>} />
        <Route path="/traffic/test-bookings" element={<ProtectedRoute><DrivingTestBookings /></ProtectedRoute>} />
        <Route path="/traffic/vehicle-registration" element={<ProtectedRoute><VehicleRegistration /></ProtectedRoute>} />
        <Route path="/traffic/vehicle-transfer" element={<ProtectedRoute><VehicleTransfer /></ProtectedRoute>} />
        <Route path="/traffic/number-plate" element={<ProtectedRoute><VehicleNumberPlate /></ProtectedRoute>} />
        <Route path="/traffic/inspections" element={<ProtectedRoute><VehicleInspection /></ProtectedRoute>} />
        <Route path="/traffic/transport-permits" element={<ProtectedRoute><TransportPermit /></ProtectedRoute>} />
        <Route path="/traffic/licence-disc" element={<ProtectedRoute><VehicleLicenceDisc /></ProtectedRoute>} />
        <Route path="/traffic/instructors" element={<ProtectedRoute><DrivingInstructors /></ProtectedRoute>} />
        <Route path="/finance" element={<ProtectedRoute><Finance /></ProtectedRoute>} />
        <Route path="/finance/government-employment" element={<ProtectedRoute><GovernmentEmployment /></ProtectedRoute>} />
        <Route path="/finance/corrections" element={<ProtectedRoute><FinanceCorrections /></ProtectedRoute>} />
        <Route path="/finance/supplier-payments" element={<ProtectedRoute><SupplierPaymentTracking /></ProtectedRoute>} />
        <Route path="/finance/complaints" element={<ProtectedRoute><FinanceComplaint /></ProtectedRoute>} />
        <Route path="/finance/retirement-tracking" element={<ProtectedRoute><RetirementTracking /></ProtectedRoute>} />
        <Route path="/finance/publications" element={<ProtectedRoute><BudgetAndTenders /></ProtectedRoute>} />
        <Route path="/finance/bank-details" element={<ProtectedRoute><BankDetails /></ProtectedRoute>} />
        <Route path="/finance/employees" element={<ProtectedRoute roles={['finance_officer', 'system_administrator']}><EmployeeRoster /></ProtectedRoute>} />
        <Route path="/pensions" element={<ProtectedRoute><Pensions /></ProtectedRoute>} />
        <Route path="/pensions/enquiry" element={<ProtectedRoute><PensionEnquiry /></ProtectedRoute>} />
        <Route path="/pensions/payments" element={<ProtectedRoute roles={['pensions_officer', 'system_administrator']}><PensionPayments /></ProtectedRoute>} />
        <Route path="/police" element={<ProtectedRoute><PoliceHub /></ProtectedRoute>} />
        <Route path="/police/identity-verification" element={<ProtectedRoute roles={['police_officer', 'system_administrator']}><Police /></ProtectedRoute>} />
        <Route path="/police/national-id-biometrics" element={<ProtectedRoute roles={['police_officer', 'system_administrator']}><NationalIdBiometricCapture /></ProtectedRoute>} />
        <Route path="/police/clearance" element={<ProtectedRoute><PoliceClearanceList /></ProtectedRoute>} />
        <Route path="/police/clearance/apply" element={<ProtectedRoute><PoliceClearanceApply /></ProtectedRoute>} />
        <Route path="/police/clearance/:id/certificate" element={<ProtectedRoute><PoliceClearanceCertificate /></ProtectedRoute>} />
        <Route path="/police/cases" element={<ProtectedRoute roles={['police_officer', 'system_administrator']}><PoliceCaseList /></ProtectedRoute>} />
        <Route path="/police/cases/track" element={<ProtectedRoute roles={['citizen']}><PoliceCaseTrack /></ProtectedRoute>} />
        <Route path="/police/cases/:id" element={<ProtectedRoute roles={['police_officer', 'system_administrator']}><PoliceCaseDetail /></ProtectedRoute>} />
        <Route path="/police/sentence-amendments" element={<ProtectedRoute roles={['system_administrator']}><PoliceSentenceAmendments /></ProtectedRoute>} />
        <Route path="/police/information" element={<ProtectedRoute><PoliceInformation /></ProtectedRoute>} />
        <Route path="/police/information-request" element={<ProtectedRoute><PoliceInformationRequest /></ProtectedRoute>} />
        <Route path="/police/reports/lost-property" element={<ProtectedRoute><LostPropertyReport /></ProtectedRoute>} />
        <Route path="/police/reports/stolen-property" element={<ProtectedRoute><StolenPropertyReport /></ProtectedRoute>} />
        <Route path="/police/reports/general-crime" element={<ProtectedRoute><GeneralCrimeReport /></ProtectedRoute>} />
        <Route path="/police/reports/cybercrime" element={<ProtectedRoute><CybercrimeReport /></ProtectedRoute>} />
        <Route path="/police/reports/missing-person" element={<ProtectedRoute><MissingPersonReport /></ProtectedRoute>} />
        <Route path="/police/reports/domestic-violence" element={<ProtectedRoute><DomesticViolenceReport /></ProtectedRoute>} />
        <Route path="/police/reports/traffic-accident" element={<ProtectedRoute><TrafficAccidentReport /></ProtectedRoute>} />
        <Route path="/police/reports/complaint" element={<ProtectedRoute><PoliceComplaint /></ProtectedRoute>} />
        <Route path="/passport" element={<ProtectedRoute><Passport /></ProtectedRoute>} />
        <Route path="/passport/:id" element={<ProtectedRoute><PassportDocument /></ProtectedRoute>} />

        <Route path="/admin" element={<ProtectedRoute roles={['system_administrator']}><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute roles={['system_administrator']}><AdminSettings /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute roles={['system_administrator']}><AdminUsers /></ProtectedRoute>} />
        <Route path="/admin/audit" element={<ProtectedRoute roles={['system_administrator']}><AdminAudit /></ProtectedRoute>} />
        <Route path="/admin/offices" element={<ProtectedRoute roles={['system_administrator']}><AdminOffices /></ProtectedRoute>} />

        <Route path="/branch/users" element={<ProtectedRoute roles={['branch_admin']}><AdminUsers /></ProtectedRoute>} />
        <Route path="/branch/budget-requests" element={<ProtectedRoute roles={['branch_admin']}><BranchBudgetRequests /></ProtectedRoute>} />

        {/* Migration 078 — Department Finance Administrator: not tied to one office, switches
            between any department+branch (DeptFinanceHub), then resolves/escalates financial
            issues (DeptFinanceIssues) and manages that office's employees (reusing AdminUsers). */}
        <Route path="/department-finance" element={<ProtectedRoute roles={['department_finance_admin']}><DeptFinanceHub /></ProtectedRoute>} />
        <Route path="/department-finance/issues" element={<ProtectedRoute roles={['department_finance_admin']}><DeptFinanceIssues /></ProtectedRoute>} />
        <Route path="/department-finance/employees" element={<ProtectedRoute roles={['department_finance_admin']}><AdminUsers /></ProtectedRoute>} />

        <Route path="/report-financial-issue" element={<ProtectedRoute roles={['citizen']}><ReportFinancialIssue /></ProtectedRoute>} />
        <Route path="/finance/budget-requests" element={<ProtectedRoute roles={['finance_officer', 'system_administrator']}><FinanceBudgetRequests /></ProtectedRoute>} />

        <Route path="*" element={<Landing />} />
      </Routes>
    </Layout>
  );
}
