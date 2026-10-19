-- 053_photo_compliance_note.sql
--
-- Supports the new real hat-detection check (see frontend/src/utils/hatCheck.js): when a citizen
-- declares a detected hat is actually a religious head covering rather than fashion headwear and
-- uploads the photo anyway (see PhotoCapture.jsx), that declaration needs to be recorded
-- somewhere durable so an officer reviewing the application can see it was self-declared, not
-- silently hidden and not silently verified either.
--
-- file_blobs (migration 050) already holds every photo/receipt/biometric/signature this system
-- stores, under one shared table — adding one optional column here, rather than a column on
-- every table that references a photo_reference, keeps that same "one place" convention and
-- makes this reusable for any future upload-time note, not just this one.

ALTER TABLE file_blobs
    ADD COLUMN IF NOT EXISTS compliance_note VARCHAR(60);
