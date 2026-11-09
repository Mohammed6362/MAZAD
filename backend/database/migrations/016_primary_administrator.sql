-- مدير رئيسي واحد يُختار صراحة من حساب قائم؛ الإدارة المفوضة لا تملك منح الصلاحيات.
BEGIN;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS primary_admin_id BIGINT REFERENCES users(id) ON DELETE RESTRICT;
COMMIT;
