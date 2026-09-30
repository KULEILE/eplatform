-- 015_create_notifications.sql
-- In-app notification centre. language is captured at creation time so a notification renders
-- correctly even if the user later changes their preferred language.

CREATE TABLE IF NOT EXISTS notifications (
    notification_id    SERIAL PRIMARY KEY,
    user_id               INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title                  VARCHAR(160) NOT NULL,
    message                 TEXT NOT NULL,
    language                 VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'st')),
    notification_type         VARCHAR(40) NOT NULL
        CHECK (notification_type IN (
            'Application Submitted', 'Verification', 'Missing Information', 'Status Change',
            'Approval', 'Rejection', 'Ready for Collection', 'Collection Reminder',
            'Processing Delay', 'System'
        )),
    related_application_id     INTEGER REFERENCES applications(application_id),
    is_read                     BOOLEAN NOT NULL DEFAULT FALSE,
    simulated_channel            VARCHAR(20) DEFAULT 'in_app'
        CHECK (simulated_channel IN ('in_app', 'sms', 'email')),
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
