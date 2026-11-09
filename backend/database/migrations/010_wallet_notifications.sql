-- إشعارات السداد اليدوي والمحفظة؛ يستبدل التحديث 012 إشعاراتها بسجل أحداث دورة البيع.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;
-- تعريف إشعارات الفواتير لهذا الإصدار؛ التحديث 012 يستبدله بإشعارات سجل أحداث البيع.
CREATE OR REPLACE FUNCTION fn_notify_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_title TEXT; v_body TEXT;
BEGIN
  IF NEW.status='paid' AND OLD.status<>'paid' THEN
    v_title:=CASE WHEN NEW.payment_method='demo_wallet' THEN 'تم السداد التجريبي' ELSE 'تم تسجيل سداد الفاتورة' END;
    v_body:=CASE WHEN NEW.payment_method='demo_wallet' THEN 'سُددت الفاتورة برصيد محفظة وهمي بالدينار الليبي: ' ELSE 'أكدت الإدارة استلام سداد الفاتورة ' END || NEW.invoice_number;
    INSERT INTO notifications(user_id,title,body,link) VALUES(NEW.buyer_id,v_title,v_body,'/account/invoices'),(NEW.seller_id,v_title,v_body,'/account/invoices');
  END IF;
  RETURN NEW;
END; $$;
COMMIT;
