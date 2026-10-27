-- Batch 32 — two follow-ups from the citizen's own review of Batch 31:
--
-- 1. "require citizen to submit that customs clearance and officer review it together with other
--    documents" — migration 075 only ever captured a TEXT reference number for customs clearance
--    (customs_clearance_reference, the Form CE 11 number), never the actual clearance document
--    itself. Every other proof requirement (ownership, import tax, police clearance) is a real
--    uploaded photo the officer can look at; customs clearance was the one exception. This adds a
--    column for that upload, so the officer verifying customs clearance (statusFlow's
--    'verify-customs-clearance') has an actual document to review, not just a typed number.
--
-- 2. "during inspection the officer must type the chassis and engine number and the system must
--    detect if they are the same as the owner entered — if they differ application must not
--    continue" — physical_inspection_notes (migration 074) was always just a free-text note; there
--    was no structured capture of what the officer actually found on the vehicle, and nothing
--    compared it against what the citizen typed on the application. These two columns record the
--    officer's own typed chassis/engine numbers (traffic.controller.js's physicalInspectionExtra
--    compares them against chassis_number/engine_number and refuses the transition on a mismatch),
--    giving a genuine audit trail of what was actually checked, not just a note saying it was.

ALTER TABLE traffic_records
  ADD COLUMN IF NOT EXISTS customs_clearance_document_reference VARCHAR(255),
  ADD COLUMN IF NOT EXISTS physical_inspection_chassis_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS physical_inspection_engine_number VARCHAR(40);
