-- 077_police_sentence_amendments.sql
--
-- "once the magistrate give suspect sentence and after officer record that sentence must not be
-- updated by officer must require the administrator approval first" (Batch 34). There was
-- previously NO way to edit a police_sentences row at all once recorded — recordSentence() in
-- policeCase.controller.js is insert-only. So this isn't a restriction on an existing
-- capability, it's a brand new one: an officer who needs to correct a sentence record submits a
-- proposed replacement with a reason; the original police_sentences row is left exactly as it
-- was until a system_administrator (never the requesting officer, and never any other
-- police_officer — see approveSentenceAmendment/rejectSentenceAmendment in
-- policeCase.controller.js) reviews it and either approves it (which then, and only then,
-- applies the change) or rejects it (which leaves the original untouched, with the rejection
-- reason recorded for the officer to see).
--
-- Stores the FULL proposed new state of the four editable sentence fields, not a partial patch
-- — same reasoning this codebase already uses elsewhere (e.g. the various resubmit() flows):
-- simpler to review, apply and audit than a column-by-column diff. proposed_outcome is required
-- (the same validation recordSentence() itself already applies is re-applied here, both at
-- request time and again at approval time); the other three stay nullable, matching how they're
-- already optional on police_sentences itself.
--
-- The partial unique index allows only one Pending request per sentence at a time, so an officer
-- can't stack several competing corrections before the first has even been reviewed.

CREATE TABLE IF NOT EXISTS police_sentence_amendment_requests (
    amendment_id              SERIAL PRIMARY KEY,
    sentence_id               INTEGER NOT NULL REFERENCES police_sentences(sentence_id),
    requested_by_user_id      INTEGER REFERENCES users(user_id),
    reason                    TEXT NOT NULL,
    proposed_outcome          VARCHAR(30) NOT NULL
        CHECK (proposed_outcome IN ('Convicted - Sentenced', 'Acquitted', 'Case Dismissed', 'Caution/Diversion')),
    proposed_sentence_details TEXT,
    proposed_court_name       VARCHAR(160),
    proposed_sentence_date    DATE,
    status                    VARCHAR(20) NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    reviewed_by_user_id       INTEGER REFERENCES users(user_id),
    review_note               TEXT,
    reviewed_at               TIMESTAMPTZ,
    is_demo_data              BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_police_sentence_amendments_sentence ON police_sentence_amendment_requests(sentence_id);
CREATE INDEX IF NOT EXISTS idx_police_sentence_amendments_status ON police_sentence_amendment_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_police_sentence_amendments_one_pending
    ON police_sentence_amendment_requests(sentence_id) WHERE status = 'Pending';
