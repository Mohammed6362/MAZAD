-- حذف العرض من القوائم مع إبقاء سجلات الملكية والرسوم والمعاملات مرتبطة به.
BEGIN;
ALTER TYPE car_status ADD VALUE IF NOT EXISTS 'deleted';
ALTER TABLE cars ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE cars ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION fn_notify_car() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO notifications(user_id,title,body,link)
      SELECT u.id, 'طلب سيارة جديد', 'وصل طلب سيارة بانتظار مراجعة الإدارة.', '/admin/review'
      FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role='admin' AND u.status='active';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO notifications(user_id,title,body,link) VALUES (
      NEW.seller_id,
      CASE NEW.status::text WHEN 'approved' THEN 'تم اعتماد سيارتك' WHEN 'rejected' THEN 'طلبك يحتاج تعديلًا' WHEN 'sold' THEN 'تم بيع سيارتك' WHEN 'deleted' THEN 'حذفت الإدارة عرض سيارتك' ELSE 'تم تحديث طلب السيارة' END,
      CASE NEW.status::text WHEN 'deleted' THEN 'حذفت الإدارة عرض السيارة من الموقع. يمكنك التواصل مع الإدارة للاستفسار.' WHEN 'rejected' THEN COALESCE(NEW.review_notes,'راجع تفاصيل طلبك.') ELSE 'تابع حالة السيارة من صفحة سياراتي.' END,
      '/account/cars'
    );
  END IF;
  RETURN NEW;
END; $$;
COMMIT;
