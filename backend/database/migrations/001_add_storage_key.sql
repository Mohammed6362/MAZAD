-- إضافة مفتاح تخزين صور السيارات لربط السجل بملفه المحلي وتمكين التنظيف الآمن.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
ALTER TABLE car_images
ADD COLUMN IF NOT EXISTS storage_key TEXT;