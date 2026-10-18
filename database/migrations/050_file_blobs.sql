-- 050_file_blobs.sql
--
-- Photos, receipts, biometric captures, signatures, and the system logo used to be saved as
-- plain files on the backend server's local disk (see middleware/upload.js), served back out
-- through a static "/uploads" mount. That works fine on a machine with a real persistent disk,
-- but breaks on free-tier hosting such as Render's free web services: their local filesystem is
-- wiped on every redeploy and on every idle spin-down, while this database (hosted separately)
-- keeps no record of that — so citizens and officers end up with 404s on images the system still
-- thinks exist.
--
-- Fix: store the file bytes themselves in this database instead of on local disk. The database
-- is the one thing in this stack that already persists reliably, so this removes the dependency
-- on the app server's disk entirely — no paid hosting plan or third-party storage account
-- needed. file_key keeps the exact same string shape the rest of the app already uses as a
-- "reference" (e.g. "photos/1700000000000-123456789.jpg"), so nothing outside upload.js,
-- uploads.controller.js, admin.controller.js (logo) and app.js's /uploads route needs to change.

CREATE TABLE IF NOT EXISTS file_blobs (
    file_key    VARCHAR(255) PRIMARY KEY,
    mime_type   VARCHAR(100) NOT NULL,
    data        BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
