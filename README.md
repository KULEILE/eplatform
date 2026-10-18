HOW TO APPLY THIS UPDATE TO YOUR PROJECT
=========================================

Every file in this zip keeps the SAME folder path it has inside your project
(gov-services-prototype). Copy each file to that exact path, overwriting the
existing file if one is already there. The two files under frontend/src/hooks/
go into a NEW folder you need to create first (you don't have that folder yet).

NEW files (don't exist in your project yet — create them):
  - database/migrations/049_death_certificate_number.sql
  - frontend/src/hooks/useApprovedDeathRecords.js   <-- create the "hooks" folder first
  - frontend/src/pages/homeAffairs/DeathCertificate.jsx
  - frontend/src/pages/passport/PassportDocument.jsx

REPLACE these existing files with the versions in this zip:
  - backend/src/controllers/homeAffairs.controller.js
  - backend/src/controllers/homeAffairsServices2.controller.js
  - backend/src/controllers/passport.controller.js
  - database/migrations/033_add_payment_receipt.sql
  - frontend/src/App.jsx
  - frontend/src/components/PhotoCapture.jsx
  - frontend/src/components/ServiceWorkflowPage.jsx
  - frontend/src/locales/en.json
  - frontend/src/locales/st.json
  - frontend/src/pages/homeAffairs/BirthCertificate.jsx
  - frontend/src/pages/homeAffairs/BirthCertificateReissue.jsx
  - frontend/src/pages/homeAffairs/BurialOrder.jsx
  - frontend/src/pages/homeAffairs/DeathCertificateRequest.jsx
  - frontend/src/pages/passport/Passport.jsx
  - frontend/src/utils/faceCheck.js

WHAT THIS UPDATE DOES
----------------------
1. Passport: a new document view (Passport No, Surname, Given names,
   Nationality, Sex, DOB, Place of birth, Date of issue/expiry, Authority,
   National ID No, signature, plus a decorative MRZ strip) styled after the
   real Lesotho passport. Officers now see the full-size photo AND full-size
   receipt image together (not just a thumbnail) and can approve/reject/
   request info right from that page. Reachable via a new "View" link on
   every row of the Passport list (citizen and officer views).

2. Death Certificate: same idea — a proper certificate view, reachable via
   "View certificate" once a request is approved. Approval now generates a
   real certificate number (new migration 049).

3. Earlier fixes already part of this batch (Burial Order / shared service
   review screen): citizens pick their death record from a dropdown of their
   own approved records instead of typing a raw internal ID; officers
   reviewing Burial Order, Death Certificate Request, Name Change, Adoption,
   and Special Marriage Licence can now click "View details" to see what the
   citizen actually submitted before approving/rejecting.

4. Birth Certificate / National ID: fee-schedule corrections (Birth
   Certificate and National ID are free in real life; a receipt is only
   needed for replacement copies).

AFTER COPYING THE FILES
------------------------
1. Run any new database migrations you don't already have, in order:
   033_add_payment_receipt.sql (if not already applied) and
   049_death_certificate_number.sql.
2. Restart the backend.
3. Rebuild the frontend (npm run build) or restart your dev server.

NOTE: Nothing has been committed or pushed to GitHub. These are your working
files — commit/push from your own machine whenever you're ready.
