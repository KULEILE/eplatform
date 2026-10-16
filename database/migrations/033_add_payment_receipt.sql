-- 033_add_payment_receipt.sql
--
-- First slice of payment-receipt support, originally scoped to both Passport and Birth
-- Certificate collection.
--
-- CORRECTED after a closer check against Lesotho's actual published Home Affairs/gov.ls service
-- pages: there is no fee anywhere for birth certificate registration or collection — that was an
-- unverified assumption made when this migration was first written, not a real Lesotho fee. The
-- app code (see backend/src/controllers/homeAffairs.controller.js,
-- markCertificateReadyForCollection) no longer requires payment_reference/receipt_image_reference
-- for the standard collection flow; those two columns on birth_certificates are kept here,
-- unused, rather than dropped, since a *replacement* copy of an already-collected certificate
-- (lost/damaged) may legitimately carry a fee — that's a separate feature, not yet built, and
-- should only reuse these columns once that fee is actually confirmed.
--
--   * Passport application — citizen must supply proof of payment when they apply; this one IS
--     real — Lesotho's published fee pages list a genuine passport application/replacement fee
--     (e.g. M430 for a lost/damaged passport replacement).
--
-- National ID is deliberately NOT touched here — the official fee schedule lists first-time
-- enrolment, renewal and replacement as free for citizens.
--
-- payment_reference: the transaction/reference number the citizen types in.
-- receipt_image_reference: an uploaded photo of the receipt/payment slip, stored the same way
-- photo_reference already is (see backend/src/middleware/upload.js and uploads.controller.js).

ALTER TABLE passport_records
    ADD COLUMN IF NOT EXISTS payment_reference        VARCHAR(60),
    ADD COLUMN IF NOT EXISTS receipt_image_reference   VARCHAR(255);

ALTER TABLE birth_certificates
    ADD COLUMN IF NOT EXISTS payment_reference        VARCHAR(60),
    ADD COLUMN IF NOT EXISTS receipt_image_reference   VARCHAR(255);
