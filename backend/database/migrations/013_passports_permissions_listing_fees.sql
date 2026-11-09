-- الجوازات الخاصة وصلاحيات الحساب ورسوم أول اعتماد وسجل قرارات الإدارة، دون خصم بأثر رجعي.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_list BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_bid BOOLEAN NOT NULL DEFAULT TRUE;
-- صورة جواز خاصة لكل حساب جديد؛ التنزيل يمر عبر صلاحية مدير نشط وليس مجلد الصور العام.
CREATE TABLE IF NOT EXISTS user_passports (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
-- سياسة رسوم العرض الحالية في صف واحد؛ لا تغير الرسوم التي سددت أو أعفيت سابقًا.
CREATE TABLE IF NOT EXISTS platform_settings (
  id SMALLINT PRIMARY KEY CHECK(id=1),
  listing_fee NUMERIC(14,3) NOT NULL DEFAULT 10 CHECK(listing_fee BETWEEN 0 AND 1000000)
);
INSERT INTO platform_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='cars' AND column_name='listing_fee_amount') THEN
    ALTER TABLE cars ADD COLUMN listing_fee_amount NUMERIC(14,3) CHECK(listing_fee_amount>=0);
    -- Previously approved cars have already completed their first review.
    UPDATE cars SET listing_fee_amount=0 WHERE status IN ('approved','sold');
  END IF;
END; $$;
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS car_id BIGINT REFERENCES cars(id) ON DELETE RESTRICT;
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_kind_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_kind_check CHECK(kind IN ('demo_top_up','auction_payment','sale_credit','auction_refund','listing_fee'));
ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_check;
ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_check CHECK((kind IN ('auction_payment','listing_fee') AND amount<0) OR (kind IN ('demo_top_up','sale_credit','auction_refund') AND amount>0));
CREATE UNIQUE INDEX IF NOT EXISTS ux_wallet_listing_fee ON wallet_transactions(car_id) WHERE kind='listing_fee';
-- سجل غير قابل للتعديل لقرارات صلاحيات الحساب، مع الفاعل والقيم السابقة والجديدة.
CREATE TABLE IF NOT EXISTS user_permission_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  actor_id BIGINT NOT NULL REFERENCES users(id),
  previous_permissions JSONB NOT NULL,
  permissions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
DROP TRIGGER IF EXISTS trg_permission_events_immutable ON user_permission_events;
-- ربط trg_permission_events_immutable بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_permission_events_immutable BEFORE UPDATE OR DELETE ON user_permission_events FOR EACH ROW EXECUTE FUNCTION fn_wallet_ledger_immutable();
COMMIT;
