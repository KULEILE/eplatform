-- 054_police_cases_arrests_sentences.sql
--
-- Gives a Police officer three real, auditable actions this system didn't have before: start a
-- case, record an arrest against that case, and record a sentence/outcome against that case —
-- the "officer must be able to start the case, arrest and the sentence if suspect" requirement.
-- Deliberately three separate tables, not one wide row, because a case can have zero or more
-- arrests (an investigation may never result in one) and an arrest can have zero or one sentence
-- (it may end in release without charge, or the matter may still be before the courts) — forcing
-- all three into one row would mean a case with two arrests either loses data or needs awkward
-- duplicate case rows.
--
-- subject_citizen_id is nullable, with a free-text subject_name alongside it, on all three
-- tables: a real police case can concern someone who isn't (yet) positively identified, or isn't
-- a citizen of this system at all. Where the subject IS a known citizen, subject_citizen_id is
-- what GET /api/police/clearance/:id/history (policeClearance.controller.js) and the
-- identity-verification lookup (police.controller.js) both query against to show a citizen's
-- case/arrest/sentence history — see backend/src/utils/policeHistory.js.

CREATE TABLE IF NOT EXISTS police_cases (
    case_id               SERIAL PRIMARY KEY,
    case_reference        VARCHAR(30) NOT NULL UNIQUE,
    subject_citizen_id    INTEGER REFERENCES citizens(citizen_id),
    subject_name          VARCHAR(160), -- used when the subject isn't a registered citizen, or isn't yet identified
    case_type             VARCHAR(40) NOT NULL DEFAULT 'Criminal Investigation'
        CHECK (case_type IN ('Criminal Investigation', 'Traffic Offense', 'Domestic Violence',
                              'Cybercrime', 'Missing Person', 'Other')),
    offense_description   TEXT NOT NULL,
    status                VARCHAR(30) NOT NULL DEFAULT 'Open'
        CHECK (status IN ('Open', 'Under Investigation', 'Referred to Court',
                           'Closed - Resolved', 'Closed - Unresolved')),
    opened_by_user_id     INTEGER REFERENCES users(user_id),
    closed_at             TIMESTAMPTZ,
    is_demo_data          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (subject_citizen_id IS NOT NULL OR subject_name IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS police_arrests (
    arrest_id                  SERIAL PRIMARY KEY,
    case_id                    INTEGER NOT NULL REFERENCES police_cases(case_id),
    arrest_reference            VARCHAR(30) NOT NULL UNIQUE,
    -- Denormalized off police_cases on purpose: an arrest can name a DIFFERENT subject than the
    -- case's own subject_citizen_id/subject_name (e.g. a case opened against "unknown suspect"
    -- is later resolved to a specific person at arrest time) rather than always matching it.
    subject_citizen_id          INTEGER REFERENCES citizens(citizen_id),
    subject_name                VARCHAR(160),
    charge                       TEXT NOT NULL,
    arrest_date                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    arresting_officer_user_id      INTEGER REFERENCES users(user_id),
    custody_status                   VARCHAR(30) NOT NULL DEFAULT 'In Custody'
        CHECK (custody_status IN ('In Custody', 'Released on Bail', 'Released Without Charge',
                                   'Transferred to Court')),
    notes                             TEXT,
    is_demo_data                      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (subject_citizen_id IS NOT NULL OR subject_name IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS police_sentences (
    sentence_id                SERIAL PRIMARY KEY,
    case_id                    INTEGER NOT NULL REFERENCES police_cases(case_id),
    arrest_id                  INTEGER REFERENCES police_arrests(arrest_id), -- nullable: a sentence can follow a summons/charge with no prior arrest record in this system
    subject_citizen_id          INTEGER REFERENCES citizens(citizen_id),
    subject_name                 VARCHAR(160),
    -- 'Convicted - Sentenced' is the ONLY outcome that counts as "a record" for Police Clearance
    -- Certificate purposes (see policeHistory.js's computeSuggestedClearanceResult) — a mere
    -- arrest, an open case, or an acquittal must never, by itself, suggest "Record Found" on a
    -- clearance certificate. That would punish someone for having been investigated or accused,
    -- not for having actually been convicted of anything.
    outcome                       VARCHAR(30) NOT NULL
        CHECK (outcome IN ('Convicted - Sentenced', 'Acquitted', 'Case Dismissed', 'Caution/Diversion')),
    sentence_details               TEXT, -- e.g. "6 months imprisonment, suspended for 2 years" / "Fine of M1000" — required when outcome = 'Convicted - Sentenced', enforced in policeCase.controller.js, not here, so the other three outcomes can legitimately leave it blank
    court_name                      VARCHAR(160),
    sentence_date                    DATE,
    recorded_by_user_id               INTEGER REFERENCES users(user_id),
    is_demo_data                       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (subject_citizen_id IS NOT NULL OR subject_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_police_cases_subject ON police_cases(subject_citizen_id);
CREATE INDEX IF NOT EXISTS idx_police_cases_status ON police_cases(status);
CREATE INDEX IF NOT EXISTS idx_police_arrests_case ON police_arrests(case_id);
CREATE INDEX IF NOT EXISTS idx_police_arrests_subject ON police_arrests(subject_citizen_id);
CREATE INDEX IF NOT EXISTS idx_police_sentences_case ON police_sentences(case_id);
CREATE INDEX IF NOT EXISTS idx_police_sentences_arrest ON police_sentences(arrest_id);
CREATE INDEX IF NOT EXISTS idx_police_sentences_subject ON police_sentences(subject_citizen_id);
