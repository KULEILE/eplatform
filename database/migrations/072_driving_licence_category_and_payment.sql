-- Batch 26 — Driving Licence: citizen picks a vehicle category, and the officer's only manual
-- step is confirming payment.
--
-- "the system must automatically generate the card it should follow this format because that
-- citizen have leaners the only steps should require officer is to check the payment is legit
-- because license is not free after officer confirm that payment is legit the system generate
-- license automatically. in Lesotho we have four categories of license which is code A for bikes,
-- code B for small cars, code C for mini trucks and code D for big trucks and citizen must select
-- which code is applying for"
--
-- licence_category: the citizen's chosen vehicle class, shown on the licence card as "Code" —
-- A (motorcycles), B (light vehicles/cars), C (minibuses/light trucks), D (heavy trucks/buses).
-- Required on a New application; a Renewal or Replacement carries the category forward from the
-- citizen's existing licence automatically (see drivingLicence.controller.js's apply()) rather
-- than asking again, since you can't silently change vehicle class by renewing.
--
-- payment_reference / receipt_image_reference: the same proof-of-payment pair migration 033
-- already established for the Passport fee (a typed transaction/receipt number plus an uploaded
-- photo of the receipt) — reused here rather than inventing a new shape, and required on ALL
-- THREE driving licence service types (a fee is due every time a licence is issued, not just on
-- a first application).
--
-- payment_verified_by_user_id / payment_verified_at: who confirmed the payment was legitimate and
-- when — the one officer action this service now requires at all for a New/Renewal/Replacement
-- application. See STATUS_FLOW's 'confirm-payment' in drivingLicence.controller.js: that single
-- action both records this and generates the licence number/issue/expiry dates in the same step,
-- replacing the old 7-step generic review chain (start-review/verify-identity/check-documents/
-- process/approve/ready-for-collection), which was redundant here — a first licence's citizen was
-- already identity-verified to earn their Learner's Permit, and a renewal/replacement citizen
-- already holds a previously-issued licence.
ALTER TABLE traffic_records
    ADD COLUMN IF NOT EXISTS licence_category VARCHAR(1) CHECK (licence_category IN ('A', 'B', 'C', 'D')),
    ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(60),
    ADD COLUMN IF NOT EXISTS receipt_image_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS payment_verified_by_user_id INTEGER REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMPTZ;
