-- 052_citizen_hand_biometrics.sql
--
-- Real hand-geometry biometric enrolment, closing the honesty gap the client flagged directly:
-- every "biometric capture" in this system up to now (National ID enrolment, Driving Licence
-- application, etc. — see migrations 034/036/042) was, underneath, just an uploaded PHOTO of a
-- hand. No measurement was ever taken from it and nothing was ever compared against anything.
--
-- From this migration on, the moment a citizen's hand is captured (see frontend/src/utils/
-- handGeometry.js, run client-side in the browser on the captured frame before upload), a real
-- geometric feature template — a rotation- and scale-normalized radial-distance signature of the
-- hand's silhouette, plus a couple of coarse shape scalars — is extracted and stored here, keyed
-- to the CITIZEN (not to any one application), so "is this citizen enrolled" is a single fact
-- and a later capture — at a different department, on a different day — can genuinely be
-- compared against it. See backend/src/utils/handMatch.js for the comparison itself, and
-- backend/src/controllers/police.controller.js's searchByHandBiometric for the one place that
-- comparison is actually used: a Police officer's audited identity-verification lookup.
--
-- This does NOT replace the existing biometric_reference_left/right image-reference columns
-- (034/036/042/041) — those stay exactly as they are, the stored evidence photo for each
-- application. This table is the new, additional, real biometric data.
CREATE TABLE IF NOT EXISTS citizen_biometrics (
    citizen_id               INTEGER PRIMARY KEY REFERENCES citizens(citizen_id),
    left_hand_template        JSONB,
    left_hand_captured_at      TIMESTAMPTZ,
    right_hand_template         JSONB,
    right_hand_captured_at       TIMESTAMPTZ,
    -- Whichever capture most recently created/updated this row, e.g. 'National ID Application',
    -- 'Driving Licence Application', 'Naturalization', 'Identity Verification', 'Self-Enrolment'.
    enrollment_source              VARCHAR(60),
    is_demo_data                     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every audited Police lookup now records which method was actually used, and — only for a
-- hand-biometric lookup — the similarity score the officer was shown for the candidate they
-- confirmed, so that number is part of the permanent audit trail, not just shown on screen once.
ALTER TABLE police_records
    ADD COLUMN IF NOT EXISTS match_method VARCHAR(20) NOT NULL DEFAULT 'Manual'
        CHECK (match_method IN ('Manual', 'Hand Biometric')),
    ADD COLUMN IF NOT EXISTS similarity_score NUMERIC(5,2);

-- An applicant captures their hands before they have a citizen_id (see naturalization.controller.js
-- and identity.controller.js) — the extracted templates (and the evidence photo, same convention
-- as every other capture here) are held on the request row itself and copied into
-- citizen_biometrics only once approval actually mints or links a citizen_id.
ALTER TABLE naturalization_requests
    ADD COLUMN IF NOT EXISTS left_hand_biometric_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS right_hand_biometric_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS left_hand_template JSONB,
    ADD COLUMN IF NOT EXISTS right_hand_template JSONB;

ALTER TABLE identity_verification_requests
    ADD COLUMN IF NOT EXISTS left_hand_biometric_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS right_hand_biometric_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS left_hand_template JSONB,
    ADD COLUMN IF NOT EXISTS right_hand_template JSONB;
