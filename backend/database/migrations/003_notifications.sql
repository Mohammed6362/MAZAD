-- جدول الإشعارات ودوال توليدها عند تغير حالة السيارة أو الفاتورة أو المزاد.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;
-- إشعارات مملوكة لحساب معين، مع الرابط ووقت القراءة؛ دوال الأحداث تنشئها داخل المعاملة.
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  link TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_notifications_user_time ON notifications(user_id, created_at DESC);

-- ينشئ إشعارات تغيير حالة السيارة للمستخدم أو الإدارة وفق نوع الحدث.

CREATE OR REPLACE FUNCTION fn_notify_car() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO notifications(user_id,title,body,link)
      SELECT u.id, 'طلب سيارة جديد', 'وصل طلب سيارة بانتظار مراجعة الإدارة.', '/admin/review'
      FROM users u JOIN user_roles r ON r.user_id=u.id WHERE r.role='admin' AND u.status='active';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO notifications(user_id,title,body,link) VALUES (
      NEW.seller_id,
      CASE NEW.status WHEN 'approved' THEN 'تم اعتماد سيارتك' WHEN 'rejected' THEN 'طلبك يحتاج تعديلًا' WHEN 'sold' THEN 'تم بيع سيارتك' ELSE 'تم تحديث طلب السيارة' END,
      CASE NEW.status WHEN 'rejected' THEN COALESCE(NEW.review_notes,'راجع تفاصيل طلبك.') ELSE 'تابع حالة السيارة من صفحة سياراتي.' END,
      '/seller/cars'
    );
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_car ON cars;
-- ربط trg_notify_car بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_notify_car AFTER INSERT OR UPDATE OF status ON cars FOR EACH ROW EXECUTE FUNCTION fn_notify_car();

-- يبلغ المزايد السابق عند تجاوزه دون نقل بياناته الخاصة إلى المزايد الجديد.

CREATE OR REPLACE FUNCTION fn_notify_bid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_bidder BIGINT;
BEGIN
  SELECT bidder_id INTO previous_bidder FROM bids WHERE auction_id=NEW.auction_id AND id<>NEW.id ORDER BY amount DESC LIMIT 1;
  IF previous_bidder IS NOT NULL AND previous_bidder<>NEW.bidder_id THEN
    INSERT INTO notifications(user_id,title,body,link) VALUES(previous_bidder,'يوجد عرض أعلى من عرضك','تم تجاوز عرضك في المزاد. يمكنك متابعة السعر وتقديم عرض جديد.','/auctions/' || NEW.auction_id);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_bid ON bids;
-- ربط trg_notify_bid بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_notify_bid AFTER INSERT ON bids FOR EACH ROW EXECUTE FUNCTION fn_notify_bid();

-- يولد إشعارات نتيجة المزاد عند تغير حالته إلى الإغلاق.

CREATE OR REPLACE FUNCTION fn_notify_auction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='closed' AND OLD.status<>'closed' THEN
    INSERT INTO notifications(user_id,title,body,link)
      SELECT DISTINCT b.bidder_id,
        CASE WHEN b.bidder_id=NEW.winner_id THEN 'فزت بالمزاد' ELSE 'انتهى المزاد' END,
        CASE WHEN b.bidder_id=NEW.winner_id THEN 'تم اعتماد نتيجة المزاد. راجع فاتورتك لإكمال الشراء.' ELSE 'أُغلق المزاد. يمكنك متابعة النتيجة من صفحة المزايدات.' END,
        '/buyer/bids' FROM bids b WHERE b.auction_id=NEW.id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_auction ON auctions;
-- ربط trg_notify_auction بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_notify_auction AFTER UPDATE OF status ON auctions FOR EACH ROW EXECUTE FUNCTION fn_notify_auction();

-- تعريف إشعارات الفواتير لهذا الإصدار؛ التحديث 012 يستبدله بإشعارات سجل أحداث البيع.

CREATE OR REPLACE FUNCTION fn_notify_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='paid' AND OLD.status<>'paid' THEN
    INSERT INTO notifications(user_id,title,body,link)
      VALUES(NEW.buyer_id,'تم تسجيل سداد الفاتورة','أكدت الإدارة استلام سداد الفاتورة ' || NEW.invoice_number,'/account/invoices'),
            (NEW.seller_id,'تم تسجيل سداد الفاتورة','أكدت الإدارة استلام سداد الفاتورة ' || NEW.invoice_number,'/account/invoices');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_invoice ON invoices;
-- ربط trg_notify_invoice بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_notify_invoice AFTER UPDATE OF status ON invoices FOR EACH ROW EXECUTE FUNCTION fn_notify_invoice();
COMMIT;
