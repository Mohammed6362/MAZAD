-- منع تعديل سجل الحركات وفرض تغطية الرصيد للحجوزات عند اعتماد المعاملة.
-- للمقارنة بين المخطط الأولي والتحديثات الحالية، راجع docs/code-guide.md.
BEGIN;
-- يرفض تحديث أو حذف سجل ثابت، ويعاد استخدامه لحركات المحفظة وأحداث البيع وقرارات الصلاحيات.
CREATE OR REPLACE FUNCTION fn_wallet_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Wallet ledger records cannot be updated or deleted'; END; $$;
DROP TRIGGER IF EXISTS trg_wallet_ledger_immutable ON wallet_transactions;
-- ربط trg_wallet_ledger_immutable بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير.
CREATE TRIGGER trg_wallet_ledger_immutable BEFORE UPDATE OR DELETE ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION fn_wallet_ledger_immutable();

-- يتحقق عند اعتماد المعاملة أن رصيد كل محفظة يغطي جميع حجوزاتها؛ لا يكفي تحقق الواجهة وحده.

CREATE OR REPLACE FUNCTION fn_wallet_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT; v_ids BIGINT[]; v_balance NUMERIC; v_reserved NUMERIC;
BEGIN
  IF TG_OP='INSERT' THEN v_ids:=ARRAY[NEW.user_id];
  ELSIF TG_OP='DELETE' THEN v_ids:=ARRAY[OLD.user_id];
  ELSE v_ids:=ARRAY[OLD.user_id,NEW.user_id]; END IF;
  FOR v_id IN SELECT DISTINCT unnest(v_ids) LOOP
    SELECT balance INTO v_balance FROM wallets WHERE user_id=v_id;
    SELECT COALESCE(SUM(amount),0) INTO v_reserved FROM wallet_holds WHERE user_id=v_id;
    IF COALESCE(v_balance,0)<v_reserved THEN RAISE EXCEPTION 'Wallet balance cannot be below reserved funds'; END IF;
  END LOOP;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS trg_wallet_balance_coverage ON wallets;
-- ربط trg_wallet_balance_coverage بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير، مع فحص مؤجل وفق تعريف القيد.
CREATE CONSTRAINT TRIGGER trg_wallet_balance_coverage AFTER INSERT OR UPDATE ON wallets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_wallet_coverage();
DROP TRIGGER IF EXISTS trg_wallet_hold_coverage ON wallet_holds;
-- ربط trg_wallet_hold_coverage بحدث الجدول يجعل القاعدة تطبق تلقائيًا داخل معاملة التغيير، مع فحص مؤجل وفق تعريف القيد.
CREATE CONSTRAINT TRIGGER trg_wallet_hold_coverage AFTER INSERT OR UPDATE OR DELETE ON wallet_holds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_wallet_coverage();
COMMIT;
