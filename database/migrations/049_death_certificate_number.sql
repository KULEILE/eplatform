-- 049_death_certificate_number.sql
--
-- Approving a death certificate request used to just flip the request's status to 'Approved'
-- with no actual certificate ever generated — the citizen was left with only a reference number
-- (request_reference) and nothing to view or print, unlike Birth Certificate (which gets its own
-- row and certificate_number the moment the underlying birth_record is approved — see migration
-- 006/008) or Burial Order (which gets order_number on approval — see migration 039).
--
-- Mirrors the Burial Order pattern exactly, since the shape is the same: the citizen requests a
-- document against an already-approved record (a death registration, here), and the approval
-- step is what should mint the official document number — not a separate "generation" step.

ALTER TABLE death_certificate_requests
    ADD COLUMN IF NOT EXISTS certificate_number VARCHAR(30) UNIQUE;
