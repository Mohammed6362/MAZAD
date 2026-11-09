-- إنشاء المحافظ والحجوزات وسجل الحركات وطرق السداد وإعداد التمديد، مع محافظ افتراضية للحسابات.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='auctions' AND column_name='payment_mode') THEN
    ALTER TABLE auctions ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'manual' CHECK(payment_mode IN ('manual','demo_wallet'));
    UPDATE auctions SET payment_mode='demo_wallet' WHERE bid_count=0;
    ALTER TABLE auctions ALTER COLUMN payment_mode SET DEFAULT 'demo_wallet';
  END IF;
END; $$;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS soft_close_seconds SMALLINT NOT NULL DEFAULT 120 CHECK(soft_close_seconds BETWEEN 0 AND 600);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method TEXT CHECK(payment_method IN ('manual','demo_wallet'));
UPDATE invoices SET payment_method='manual' WHERE status='paid' AND payment_method IS NULL;

-- رصيد حساب المستخدم؛ المتاح يحسب بعد طرح حجوزات المزادات، وتخزن المبالغ بنوع NUMERIC.

CREATE TABLE IF NOT EXISTS wallets (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  balance NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK(balance>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- حجز العرض الأعلى لكل مزاد؛ ينتقل إلى المزايد الجديد أو يزال عند الإلغاء أو عدم البيع.
CREATE TABLE IF NOT EXISTS wallet_holds (
  auction_id BIGINT PRIMARY KEY REFERENCES auctions(id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES wallets(user_id) ON DELETE RESTRICT,
  amount NUMERIC(14,3) NOT NULL CHECK(amount>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_wallet_holds_user ON wallet_holds(user_id);
-- دفتر حركات ثابت للشحن والخصم والحصيلة والاسترداد والرسوم وفق أنواع التحديثات.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES wallets(user_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('demo_top_up','auction_payment','sale_credit')),
  amount NUMERIC(14,3) NOT NULL CHECK(amount<>0),
  balance_after NUMERIC(14,3) NOT NULL CHECK(balance_after>=0),
  invoice_id BIGINT REFERENCES invoices(id) ON DELETE RESTRICT,
  request_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_key),
  UNIQUE(user_id,invoice_id,kind),
  CHECK((kind='auction_payment' AND amount<0) OR (kind IN ('demo_top_up','sale_credit') AND amount>0))
);
CREATE INDEX IF NOT EXISTS ix_wallet_transactions_user ON wallet_transactions(user_id,created_at DESC);
-- ينشئ محفظة صفرية للحساب الجديد دون تكرار إذا كانت موجودة.
CREATE OR REPLACE FUNCTION fn_default_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wallets(user_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_users_default_wallet ON users;
-- ربط trg_users_default_wallet بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_users_default_wallet AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION fn_default_wallet();
INSERT INTO wallets(user_id) SELECT id FROM users ON CONFLICT DO NOTHING;
COMMIT;
