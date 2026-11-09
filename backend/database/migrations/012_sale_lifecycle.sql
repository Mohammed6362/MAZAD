-- مهلة سداد الفوز وضمان المعاملة وسجل الأحداث وأوراق الملكية؛ يحافظ على التسويات السابقة عند التحديث.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS payment_due_hours INTEGER NOT NULL DEFAULT 48 CHECK(payment_due_hours BETWEEN 1 AND 168);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='invoices' AND column_name='sale_status') THEN
    ALTER TABLE invoices ADD COLUMN sale_status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK(sale_status IN ('awaiting_payment','awaiting_handover','handed_over','disputed','completed','cancelled','expired'));
    ALTER TABLE invoices ADD COLUMN settlement_state TEXT NOT NULL DEFAULT 'unpaid' CHECK(settlement_state IN ('unpaid','escrow','released','refunded','manual'));
    UPDATE invoices SET sale_status=CASE WHEN status='paid' THEN 'completed' WHEN status='cancelled' THEN 'cancelled' WHEN status='disputed' THEN 'disputed' ELSE 'awaiting_payment' END,
      settlement_state=CASE WHEN status='paid' AND payment_method='demo_wallet' THEN 'released' WHEN status='paid' THEN 'manual' ELSE 'unpaid' END;
    UPDATE invoices SET due_at=clock_timestamp()+INTERVAL '48 hours' WHERE status='pending' AND due_at IS NULL;
  END IF;
END; $$;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS handover_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dispute_reason TEXT;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_paid;
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_paid CHECK((status<>'paid' OR paid_at IS NOT NULL) AND (status<>'pending' OR paid_at IS NULL));
CREATE INDEX IF NOT EXISTS ix_invoices_payment_deadline ON invoices(due_at) WHERE sale_status='awaiting_payment';
-- رصيد الفاتورة المدفوع والمحجوز للمعاملة، خارج أرصدة المحافظ حتى الاستلام أو الاسترداد.
CREATE TABLE IF NOT EXISTS invoice_escrows (
  invoice_id BIGINT PRIMARY KEY REFERENCES invoices(id) ON DELETE RESTRICT,
  amount NUMERIC(14,3) NOT NULL CHECK(amount>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- سجل أحداث البيع الثابت؛ يحفظ الفاعل والسبب والتوقيت ويولد إشعارات الأطراف.
CREATE TABLE IF NOT EXISTS invoice_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  actor_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_invoice_events_invoice ON invoice_events(invoice_id,id);
DROP TRIGGER IF EXISTS trg_invoice_events_immutable ON invoice_events;
-- ربط trg_invoice_events_immutable بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_invoice_events_immutable BEFORE UPDATE OR DELETE ON invoice_events FOR EACH ROW EXECUTE FUNCTION fn_wallet_ledger_immutable();
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_kind_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_kind_check CHECK(kind IN ('demo_top_up','auction_payment','sale_credit','auction_refund','listing_fee'));
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_check CHECK((kind IN ('auction_payment','listing_fee') AND amount<0) OR (kind IN ('demo_top_up','sale_credit','auction_refund') AND amount>0));

ALTER TABLE cars ADD COLUMN IF NOT EXISTS ownership_status TEXT NOT NULL DEFAULT 'missing' CHECK(ownership_status IN ('missing','pending','verified'));
ALTER TABLE cars ADD COLUMN IF NOT EXISTS ownership_revision INTEGER NOT NULL DEFAULT 1;
-- مفاتيح صور الملكية الخاصة ونوعها؛ لا تدخل في استعلامات إعلان السيارة العامة.
CREATE TABLE IF NOT EXISTS car_ownership_documents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  car_id BIGINT NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_car_ownership_documents_car ON car_ownership_documents(car_id,id);

-- ينشئ إشعارات طرفي البيع من الحدث المحفوظ ويبلغ الإدارة بالاعتراضات المفتوحة.

CREATE OR REPLACE FUNCTION fn_notify_sale_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_invoice invoices%ROWTYPE; v_title TEXT;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id=NEW.invoice_id;
  v_title:=CASE NEW.kind
    WHEN 'payment_escrow' THEN 'سداد تجريبي محفوظ حتى تأكيد الاستلام'
    WHEN 'manual_payment' THEN 'أكدت الإدارة السداد اليدوي'
    WHEN 'handover' THEN 'سجّل البائع تسليم السيارة'
    WHEN 'completed' THEN 'اكتمل البيع وتأكيد الاستلام'
    WHEN 'dispute' THEN 'فُتح اعتراض على المعاملة'
    WHEN 'resume' THEN 'عالجت الإدارة الاعتراض وأعادت المعاملة'
    WHEN 'cancelled' THEN 'ألغت الإدارة المعاملة'
    WHEN 'expired' THEN 'انتهت مهلة السداد وأُلغي الفوز'
    ELSE NULL END;
  IF v_title IS NOT NULL THEN
    INSERT INTO notifications(user_id,title,body,link) VALUES
      (v_invoice.buyer_id,v_title,v_invoice.invoice_number||' · '||NEW.note,'/account/invoices'),
      (v_invoice.seller_id,v_title,v_invoice.invoice_number||' · '||NEW.note,'/account/invoices');
  END IF;
  IF NEW.kind='dispute' THEN
    INSERT INTO notifications(user_id,title,body,link) SELECT r.user_id,v_title,v_invoice.invoice_number||' · '||NEW.note,'/admin/invoices' FROM user_roles r JOIN users u ON u.id=r.user_id WHERE r.role='admin' AND u.status='active';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_sale_event ON invoice_events;
-- ربط trg_notify_sale_event بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_notify_sale_event AFTER INSERT ON invoice_events FOR EACH ROW EXECUTE FUNCTION fn_notify_sale_event();
-- Payment/lifecycle notifications now come from the transactional event ledger.
-- تعريف إشعارات الفواتير لهذا الإصدار؛ التحديث 012 يستبدله بإشعارات سجل أحداث البيع.
CREATE OR REPLACE FUNCTION fn_notify_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NEW; END; $$;
COMMIT;
