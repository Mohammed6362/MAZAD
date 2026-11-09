-- إضافة مفتاح تخزين الصور وملاحظات المراجعة وجدول الجلسات وفهرس انتهاء الصلاحية.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;

ALTER TABLE car_images
    ADD COLUMN IF NOT EXISTS storage_key TEXT;

ALTER TABLE cars
    ADD COLUMN IF NOT EXISTS review_notes TEXT;

-- جلسات Express مع بيانات JSON وتاريخ انتهاء؛ معرّف الجلسة هو ما يحمله ملف الارتباط.

CREATE TABLE IF NOT EXISTS user_sessions (
    sid TEXT PRIMARY KEY,
    sess JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_user_sessions_expires
    ON user_sessions (expires_at);

COMMIT;
