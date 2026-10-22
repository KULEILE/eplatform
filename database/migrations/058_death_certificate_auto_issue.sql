-- 058_death_certificate_auto_issue.sql
--
-- Previously, getting an actual death certificate meant a SEPARATE service ("Death Certificate
-- Issuance" — death_certificate_requests, see migrations 038/049): a family member had to find
-- the approved death registration and file a second request, which an officer then reviewed and
-- approved a second time before a certificate_number was minted. That service is being removed
-- (see homeAffairsServices2.controller.js and homeAffairs.routes.js) because it was pure extra
-- waiting for something the system already knows how to do the moment a death registration
-- itself is approved.
--
-- This migration adds the certificate fields directly onto death_records instead, the same
-- simpler pattern already used by Burial Order's order_number (migration 039) and Birth
-- Certificate's certificate_number (migration 006): the certificate is a property of the
-- approved record, not a separate thing someone has to ask for. See approveDeath in
-- homeAffairs.controller.js, which now assigns certificate_number at the same moment it marks
-- the registration 'Approved' and flags the citizen as deceased.
--
-- Nothing here deletes the old death_certificate_requests table or any row in it — any
-- certificate numbers already issued through the old service stay exactly as they were on
-- record; this migration only stops new ones from being created that way.

ALTER TABLE death_records ADD COLUMN IF NOT EXISTS certificate_number VARCHAR(30) UNIQUE;
ALTER TABLE death_records ADD COLUMN IF NOT EXISTS certificate_issued_at TIMESTAMPTZ;
