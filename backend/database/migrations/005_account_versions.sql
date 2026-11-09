-- إضافة رقم إصدار مصادقة للحساب حتى تُبطل الجلسات عند تغيير الأمان أو إيقاف المستخدم.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;
COMMIT;
