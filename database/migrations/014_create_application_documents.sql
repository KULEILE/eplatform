-- 014_create_application_documents.sql
-- Supporting documents uploaded for an application. For the prototype, files are stored on
-- local disk under backend/uploads/documents and referenced by path (see middleware/upload.js).

CREATE TABLE IF NOT EXISTS application_documents (
    document_id          SERIAL PRIMARY KEY,
    application_id          INTEGER NOT NULL REFERENCES applications(application_id) ON DELETE CASCADE,
    document_type            VARCHAR(80) NOT NULL, -- e.g. 'Proof of Birth Notification', 'Parent ID Copy'
    file_reference             VARCHAR(255) NOT NULL,
    original_filename          VARCHAR(255),
    mime_type                   VARCHAR(100),
    file_size_bytes              INTEGER,
    verification_status          VARCHAR(20) NOT NULL DEFAULT 'Pending'
        CHECK (verification_status IN ('Pending', 'Verified', 'Rejected')),
    uploaded_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at                    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_application_documents_application ON application_documents(application_id);
