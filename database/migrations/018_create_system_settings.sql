-- 018_create_system_settings.sql
-- Single-row configuration table the System Administrator edits through /admin/settings and
-- /admin/logo. Frontend reads this on load to render the header branding and defaults.

CREATE TABLE IF NOT EXISTS system_settings (
    system_settings_id     SERIAL PRIMARY KEY,
    system_name              VARCHAR(160) NOT NULL DEFAULT 'Integrated Government Services',
    government_logo_reference VARCHAR(255), -- NULL = use fallback text/logo
    default_language           VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (default_language IN ('en', 'st')),
    default_font_size            VARCHAR(20) NOT NULL DEFAULT 'Medium'
        CHECK (default_font_size IN ('Small', 'Medium', 'Large', 'Extra Large')),
    default_display_mode           VARCHAR(20) NOT NULL DEFAULT 'Normal'
        CHECK (default_display_mode IN ('Normal', 'High Contrast')),
    default_brightness               VARCHAR(20) NOT NULL DEFAULT 'Normal'
        CHECK (default_brightness IN ('Low', 'Normal', 'High')),
    updated_by_user_id                  INTEGER REFERENCES users(user_id),
    updated_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one settings row should ever exist
INSERT INTO system_settings (system_name)
SELECT 'Integrated Government Services'
WHERE NOT EXISTS (SELECT 1 FROM system_settings);
