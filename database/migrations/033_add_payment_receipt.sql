-- 033_add_payment_receipt.sql
--
-- First slice of payment-receipt support (see passport fee schedule and National ID's official
-- "free" status — researched against the real Government of Lesotho fee pages). Scoped to the
-- two services that already have a clean place to attach it:
--
--   * Passport application — citizen must supply proof of payment when they apply, since the
--     passport fee is paid up front (M130-M630+ depending on type).
--   * Birth certificate collection — the registration itself is free, but reissuing/collecting
--     the physical certificate is where a fee commonly applies in practice, and this is also
--     the one home-affairs document that already has a real "Ready for Collection" gate to
--     attach the requirement to (marriage/divorce certificates have no physical collection step
--     in this system yet, so a receipt requirement has nowhere to attach for those two).
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