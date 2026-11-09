-- إضافة قيمة user للدور الموحد قبل تحويل الإسنادات القديمة في التحديث اللاحق.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
-- A new enum value must commit before it can be used by the next migration.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'user';
